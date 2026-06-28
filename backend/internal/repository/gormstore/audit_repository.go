package gormstore

import (
	"context"

	"gorm.io/gorm"

	"surebet/backend/internal/models"
)

type AuditLogRepository struct {
	db *gorm.DB
}

func NewAuditLogRepository(db *gorm.DB) *AuditLogRepository {
	return &AuditLogRepository{db: db}
}

func (r *AuditLogRepository) Append(ctx context.Context, entry models.AuditLog) error {
	return r.db.WithContext(ctx).Create(&entry).Error
}
