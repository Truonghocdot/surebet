package gormstore

import (
	"context"
	"time"

	"gorm.io/gorm"

	"surebet/backend/internal/models"
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

type TelegramNotificationLogRepository struct {
	db *gorm.DB
}

func NewTelegramNotificationLogRepository(db *gorm.DB) *TelegramNotificationLogRepository {
	return &TelegramNotificationLogRepository{db: db}
}

func (r *TelegramNotificationLogRepository) HasRecentSent(
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
		Where("status = ?", "sent").
		Where("sent_at >= ?", since.UTC()).
		Count(&count).Error
	return count > 0, err
}

func (r *TelegramNotificationLogRepository) Create(ctx context.Context, log models.TelegramNotificationLog) error {
	return r.db.WithContext(ctx).Table("telegram_notification_logs").Create(&log).Error
}
