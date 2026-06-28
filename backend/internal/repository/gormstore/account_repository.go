package gormstore

import (
	"context"
	"time"

	"gorm.io/gorm"

	"surebet/backend/internal/models"
)

type AccountRepository struct {
	db *gorm.DB
}

func NewAccountRepository(db *gorm.DB) *AccountRepository {
	return &AccountRepository{db: db}
}

func (r *AccountRepository) GetByID(ctx context.Context, id string) (models.Account, error) {
	var account models.Account
	err := r.db.WithContext(ctx).Where("id = ?", id).First(&account).Error
	return account, mapError(err)
}

func (r *AccountRepository) List(ctx context.Context) ([]models.Account, error) {
	var accounts []models.Account
	err := r.db.WithContext(ctx).Order("created_at asc").Find(&accounts).Error
	return accounts, err
}

func (r *AccountRepository) ListByBookmaker(ctx context.Context, bookmakerID string) ([]models.Account, error) {
	var accounts []models.Account
	err := r.db.WithContext(ctx).
		Where("bookmaker_id = ?", bookmakerID).
		Order("created_at asc").
		Find(&accounts).Error
	return accounts, err
}

func (r *AccountRepository) Upsert(ctx context.Context, account models.Account) error {
	return r.db.WithContext(ctx).Save(&account).Error
}

func (r *AccountRepository) UpdateBalance(ctx context.Context, accountID string, balance float64, updatedAt time.Time) error {
	return r.db.WithContext(ctx).
		Model(&models.Account{}).
		Where("id = ?", accountID).
		Updates(map[string]any{
			"balance":    balance,
			"updated_at": updatedAt,
		}).Error
}
