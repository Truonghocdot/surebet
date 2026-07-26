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
