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
			"(status IN ? OR (status = ? AND sent_at >= ?) OR (status = ? AND updated_at >= ?))",
			[]string{"pending", "processing"},
			"sent",
			since.UTC(),
			"failed",
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

func (r *TelegramNotificationLogRepository) RetryOrFail(
	ctx context.Context,
	job models.TelegramNotificationLog,
	errorMessage string,
	retryDelay time.Duration,
	maxAttempts int,
	attemptedAt time.Time,
) error {
	status := "pending"
	availableAt := attemptedAt.UTC().Add(retryDelay)
	values := map[string]any{
		"status":        status,
		"available_at":  availableAt,
		"reserved_at":   nil,
		"error_message": errorMessage,
		"updated_at":    attemptedAt.UTC(),
	}

	if job.AttemptCount >= maxAttempts {
		values["status"] = "failed"
		values["available_at"] = nil
	}

	return r.db.WithContext(ctx).
		Table("telegram_notification_logs").
		Where("id = ?", job.ID).
		Updates(values).Error
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
