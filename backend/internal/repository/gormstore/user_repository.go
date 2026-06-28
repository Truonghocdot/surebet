package gormstore

import (
	"context"
	"time"

	"gorm.io/gorm"

	"surebet/backend/internal/models"
)

type UserRepository struct {
	db *gorm.DB
}

func NewUserRepository(db *gorm.DB) *UserRepository {
	return &UserRepository{db: db}
}

func (r *UserRepository) GetByID(ctx context.Context, id string) (models.User, error) {
	var user models.User
	err := r.db.WithContext(ctx).Where("id = ?", id).First(&user).Error
	return user, mapError(err)
}

func (r *UserRepository) GetByEmail(ctx context.Context, email string) (models.User, error) {
	var user models.User
	err := r.db.WithContext(ctx).Where("email = ?", email).First(&user).Error
	return user, mapError(err)
}

func (r *UserRepository) List(ctx context.Context) ([]models.User, error) {
	var users []models.User
	err := r.db.WithContext(ctx).Order("created_at asc").Find(&users).Error
	return users, err
}

func (r *UserRepository) Upsert(ctx context.Context, user models.User) error {
	return r.db.WithContext(ctx).Save(&user).Error
}

func (r *UserRepository) UpdateLastLogin(ctx context.Context, id string, loggedAt time.Time) error {
	return r.db.WithContext(ctx).
		Model(&models.User{}).
		Where("id = ?", id).
		Updates(map[string]any{
			"last_login_at": loggedAt,
			"updated_at":    loggedAt,
		}).Error
}
