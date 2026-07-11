package gormstore

import (
	"context"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"surebet/backend/internal/models"
)

type RuntimeSettingRepository struct {
	db *gorm.DB
}

func NewRuntimeSettingRepository(db *gorm.DB) *RuntimeSettingRepository {
	return &RuntimeSettingRepository{db: db}
}

func (r *RuntimeSettingRepository) ListByPrefix(
	ctx context.Context,
	prefix string,
) ([]models.RuntimeSetting, error) {
	var items []models.RuntimeSetting
	query := r.db.WithContext(ctx).Table("runtime_settings").Order("key asc")
	if prefix != "" {
		query = query.Where("key LIKE ?", prefix+"%")
	}
	err := query.Find(&items).Error
	return items, err
}

func (r *RuntimeSettingRepository) UpsertMany(
	ctx context.Context,
	settings []models.RuntimeSetting,
) error {
	if len(settings) == 0 {
		return nil
	}

	now := time.Now().UTC()
	for index := range settings {
		if settings[index].CreatedAt.IsZero() {
			settings[index].CreatedAt = now
		}
		settings[index].UpdatedAt = now
	}

	return r.db.WithContext(ctx).
		Table("runtime_settings").
		Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "key"}},
			DoUpdates: clause.Assignments(map[string]any{
				"value":      clause.Column{Name: "excluded.value"},
				"updated_at": clause.Column{Name: "excluded.updated_at"},
			}),
		}).
		Create(&settings).Error
}
