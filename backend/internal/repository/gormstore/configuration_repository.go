package gormstore

import (
	"context"

	"gorm.io/gorm"

	"surebet/backend/internal/models"
)

type ConfigurationRepository struct {
	db *gorm.DB
}

func NewConfigurationRepository(db *gorm.DB) *ConfigurationRepository {
	return &ConfigurationRepository{db: db}
}

func (r *ConfigurationRepository) GetByKey(ctx context.Context, key string) (models.Configuration, error) {
	var configuration models.Configuration
	err := r.db.WithContext(ctx).Where("key = ?", key).First(&configuration).Error
	return configuration, mapError(err)
}

func (r *ConfigurationRepository) GetByKeyRaw(ctx context.Context, key string) (models.Configuration, error) {
	var configuration models.Configuration
	err := r.db.WithContext(ctx).Where("key = ?", key).First(&configuration).Error
	return configuration, err
}

func (r *ConfigurationRepository) List(ctx context.Context, prefix string) ([]models.Configuration, error) {
	var configurations []models.Configuration
	query := r.db.WithContext(ctx).Order("key asc")
	if prefix != "" {
		query = query.Where("key LIKE ?", prefix+"%")
	}
	err := query.Find(&configurations).Error
	return configurations, err
}

func (r *ConfigurationRepository) Upsert(ctx context.Context, configuration models.Configuration) error {
	return r.db.WithContext(ctx).Save(&configuration).Error
}
