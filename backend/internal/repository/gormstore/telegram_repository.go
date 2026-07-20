package gormstore

import (
	"context"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"surebet/backend/internal/models"
	"surebet/backend/internal/repository"
)

type TelegramRecipientRepository struct {
	db *gorm.DB
}

func NewTelegramRecipientRepository(db *gorm.DB) *TelegramRecipientRepository {
	return &TelegramRecipientRepository{db: db}
}

func EnsureTelegramRecipientSchema(db *gorm.DB) error {
	return db.AutoMigrate(&models.TelegramRecipient{})
}

func (r *TelegramRecipientRepository) ListAll(ctx context.Context) ([]models.TelegramRecipient, error) {
	var recipients []models.TelegramRecipient
	err := r.db.WithContext(ctx).
		Table("telegram_recipients").
		Order("is_active desc").
		Order("updated_at desc").
		Order("id asc").
		Find(&recipients).Error
	return recipients, err
}

func (r *TelegramRecipientRepository) ListActive(ctx context.Context) ([]models.TelegramRecipient, error) {
	var recipients []models.TelegramRecipient
	err := r.db.WithContext(ctx).
		Table("telegram_recipients").
		Where("is_active = ?", true).
		Order("id asc").
		Find(&recipients).Error
	return recipients, err
}

func (r *TelegramRecipientRepository) GetByID(ctx context.Context, id uint64) (models.TelegramRecipient, error) {
	var recipient models.TelegramRecipient
	err := r.db.WithContext(ctx).
		Table("telegram_recipients").
		Where("id = ?", id).
		First(&recipient).Error
	if err == nil {
		return recipient, nil
	}
	if err == gorm.ErrRecordNotFound {
		return models.TelegramRecipient{}, repository.ErrNotFound
	}
	return models.TelegramRecipient{}, err
}

func (r *TelegramRecipientRepository) GetByChatID(
	ctx context.Context,
	chatID string,
) (models.TelegramRecipient, error) {
	var recipient models.TelegramRecipient
	err := r.db.WithContext(ctx).
		Table("telegram_recipients").
		Where("chat_id = ?", chatID).
		First(&recipient).Error
	if err == nil {
		return recipient, nil
	}
	if err == gorm.ErrRecordNotFound {
		return models.TelegramRecipient{}, repository.ErrNotFound
	}
	return models.TelegramRecipient{}, err
}

func (r *TelegramRecipientRepository) Upsert(
	ctx context.Context,
	recipient models.TelegramRecipient,
) error {
	now := time.Now().UTC()
	if recipient.CreatedAt.IsZero() {
		recipient.CreatedAt = now
	}
	if recipient.UpdatedAt.IsZero() {
		recipient.UpdatedAt = now
	}

	return r.db.WithContext(ctx).
		Table("telegram_recipients").
		Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "chat_id"}},
			DoUpdates: clause.Assignments(map[string]any{
				"name":                               clause.Column{Name: "excluded.name"},
				"is_active":                          clause.Column{Name: "excluded.is_active"},
				"notes":                              clause.Column{Name: "excluded.notes"},
				"source":                             gorm.Expr("COALESCE(NULLIF(excluded.source, ''), telegram_recipients.source)"),
				"chat_type":                          clause.Column{Name: "excluded.chat_type"},
				"telegram_username":                  clause.Column{Name: "excluded.telegram_username"},
				"membership_status":                  clause.Column{Name: "excluded.membership_status"},
				"receives_one_negative_one_positive": clause.Column{Name: "excluded.receives_one_negative_one_positive"},
				"receives_two_negative":              clause.Column{Name: "excluded.receives_two_negative"},
				"last_seen_at":                       clause.Column{Name: "excluded.last_seen_at"},
				"updated_at":                         clause.Column{Name: "excluded.updated_at"},
			}),
		}).
		Create(&recipient).Error
}

func (r *TelegramRecipientRepository) Save(
	ctx context.Context,
	recipient models.TelegramRecipient,
) (models.TelegramRecipient, error) {
	now := time.Now().UTC()
	if recipient.CreatedAt.IsZero() {
		recipient.CreatedAt = now
	}
	recipient.UpdatedAt = now

	err := r.db.WithContext(ctx).
		Table("telegram_recipients").
		Save(&recipient).Error
	if err != nil {
		return models.TelegramRecipient{}, err
	}

	return recipient, nil
}

func (r *TelegramRecipientRepository) DeleteByID(ctx context.Context, id uint64) error {
	result := r.db.WithContext(ctx).
		Table("telegram_recipients").
		Where("id = ?", id).
		Delete(&models.TelegramRecipient{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return repository.ErrNotFound
	}
	return nil
}

type TelegramNotificationLogRepository struct {
	db *gorm.DB
}

func NewTelegramNotificationLogRepository(db *gorm.DB) *TelegramNotificationLogRepository {
	return &TelegramNotificationLogRepository{db: db}
}

func (r *TelegramNotificationLogRepository) HasPendingOrRecentSent(
	ctx context.Context,
	recipientID uint64,
	opportunityID string,
	since time.Time,
) (bool, error) {
	var count int64
	err := r.db.WithContext(ctx).
		Table("telegram_notification_logs").
		Where("recipient_id = ?", recipientID).
		Where("opportunity_id = ?", opportunityID).
		Where(
			"(status IN ? OR (status = ? AND sent_at >= ?))",
			[]string{"pending", "processing"},
			"sent",
			since.UTC(),
		).
		Count(&count).Error
	return count > 0, err
}

func (r *TelegramNotificationLogRepository) Create(ctx context.Context, log models.TelegramNotificationLog) error {
	return r.db.WithContext(ctx).Table("telegram_notification_logs").Create(&log).Error
}

func (r *TelegramNotificationLogRepository) ClaimPending(
	ctx context.Context,
	limit int,
) ([]models.TelegramNotificationLog, error) {
	if limit <= 0 {
		limit = 1
	}

	var jobs []models.TelegramNotificationLog
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		now := time.Now().UTC()
		if err := tx.
			Table("telegram_notification_logs").
			Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"}).
			Where("status = ?", "pending").
			Where("available_at IS NULL OR available_at <= ?", now).
			Order("available_at asc nulls first").
			Order("created_at asc").
			Limit(limit).
			Find(&jobs).Error; err != nil {
			return err
		}

		for index := range jobs {
			jobs[index].Status = "processing"
			jobs[index].AttemptCount += 1
			jobs[index].ReservedAt = &now
			jobs[index].UpdatedAt = now

			if err := tx.
				Table("telegram_notification_logs").
				Where("id = ? AND status = ?", jobs[index].ID, "pending").
				Updates(map[string]any{
					"status":        "processing",
					"attempt_count": gorm.Expr("attempt_count + 1"),
					"reserved_at":   now,
					"updated_at":    now,
					"error_message": "",
				}).Error; err != nil {
				return err
			}
		}

		return nil
	})

	return jobs, err
}

func (r *TelegramNotificationLogRepository) MarkSent(ctx context.Context, id string, sentAt time.Time) error {
	return r.db.WithContext(ctx).
		Table("telegram_notification_logs").
		Where("id = ?", id).
		Updates(map[string]any{
			"status":        "sent",
			"sent_at":       sentAt.UTC(),
			"reserved_at":   nil,
			"error_message": "",
			"updated_at":    sentAt.UTC(),
		}).Error
}

func (r *TelegramNotificationLogRepository) MarkFailed(
	ctx context.Context,
	id string,
	errorMessage string,
	attemptedAt time.Time,
) error {
	return r.db.WithContext(ctx).
		Table("telegram_notification_logs").
		Where("id = ?", id).
		Updates(map[string]any{
			"status":        "failed",
			"available_at":  nil,
			"reserved_at":   nil,
			"error_message": errorMessage,
			"updated_at":    attemptedAt.UTC(),
		}).Error
}

func (r *TelegramNotificationLogRepository) MarkExpired(
	ctx context.Context,
	id string,
	reason string,
	expiredAt time.Time,
) error {
	return r.db.WithContext(ctx).
		Table("telegram_notification_logs").
		Where("id = ?", id).
		Updates(map[string]any{
			"status":        "expired",
			"available_at":  nil,
			"reserved_at":   nil,
			"error_message": reason,
			"updated_at":    expiredAt.UTC(),
		}).Error
}
