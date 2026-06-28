package gormstore

import (
	"context"

	"gorm.io/gorm"

	"surebet/backend/internal/models"
)

type BookmakerRepository struct {
	db *gorm.DB
}

func NewBookmakerRepository(db *gorm.DB) *BookmakerRepository {
	return &BookmakerRepository{db: db}
}

func (r *BookmakerRepository) GetByCode(ctx context.Context, code string) (models.Bookmaker, error) {
	var bookmaker models.Bookmaker
	err := r.db.WithContext(ctx).Where("code = ?", code).First(&bookmaker).Error
	return bookmaker, mapError(err)
}

func (r *BookmakerRepository) List(ctx context.Context) ([]models.Bookmaker, error) {
	var bookmakers []models.Bookmaker
	err := r.db.WithContext(ctx).Order("name asc").Find(&bookmakers).Error
	return bookmakers, err
}

func (r *BookmakerRepository) ListEnabled(ctx context.Context) ([]models.Bookmaker, error) {
	var bookmakers []models.Bookmaker
	err := r.db.WithContext(ctx).Where("is_enabled = ?", true).Order("name asc").Find(&bookmakers).Error
	return bookmakers, err
}

func (r *BookmakerRepository) Upsert(ctx context.Context, bookmaker models.Bookmaker) error {
	return r.db.WithContext(ctx).Save(&bookmaker).Error
}
