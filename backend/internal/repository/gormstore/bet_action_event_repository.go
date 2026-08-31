package gormstore

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"surebet/backend/internal/models"
	"surebet/backend/internal/repository"
)

type BetActionEventRepository struct {
	db *gorm.DB
}

func NewBetActionEventRepository(db *gorm.DB) *BetActionEventRepository {
	return &BetActionEventRepository{db: db}
}

func (r *BetActionEventRepository) Append(
	ctx context.Context,
	event models.BetActionEvent,
) (models.BetActionEvent, bool, error) {
	var stored models.BetActionEvent
	created := false
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var err error
		stored, created, err = appendBetActionEvent(tx, event)
		return err
	})
	return stored, created, err
}

func (r *BetActionEventRepository) ListByAction(
	ctx context.Context,
	actionID string,
	afterSequence int64,
	limit int,
) ([]models.BetActionEvent, error) {
	var events []models.BetActionEvent
	query := r.db.WithContext(ctx).
		Where("action_id = ? AND sequence > ?", actionID, afterSequence).
		Order("sequence asc")
	if limit > 0 {
		query = query.Limit(limit)
	}
	if err := query.Find(&events).Error; err != nil {
		return nil, mapError(err)
	}
	return events, nil
}

func appendBetActionEvent(
	tx *gorm.DB,
	event models.BetActionEvent,
) (models.BetActionEvent, bool, error) {
	if event.ActionID == "" || event.IdempotencyKey == "" {
		return models.BetActionEvent{}, false, repository.ErrVersionConflict
	}
	var existing models.BetActionEvent
	err := tx.Where("idempotency_key = ?", event.IdempotencyKey).First(&existing).Error
	if err == nil {
		return existing, false, nil
	}
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return models.BetActionEvent{}, false, mapError(err)
	}

	var action models.BetAction
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Select("id").
		Where("id = ?", event.ActionID).
		First(&action).Error; err != nil {
		return models.BetActionEvent{}, false, mapError(err)
	}
	if event.Sequence <= 0 {
		var maximum int64
		if err := tx.Model(&models.BetActionEvent{}).
			Where("action_id = ?", event.ActionID).
			Select("COALESCE(MAX(sequence), 0)").
			Scan(&maximum).Error; err != nil {
			return models.BetActionEvent{}, false, mapError(err)
		}
		event.Sequence = maximum + 1
	}
	if event.ID == "" {
		event.ID = uuid.NewString()
	}
	if event.OccurredAt.IsZero() {
		event.OccurredAt = time.Now().UTC()
	}
	if event.CreatedAt.IsZero() {
		event.CreatedAt = event.OccurredAt
	}
	if event.UpdatedAt.IsZero() {
		event.UpdatedAt = event.OccurredAt
	}
	if event.Metadata == nil {
		event.Metadata = []byte("{}")
	}
	if err := tx.Create(&event).Error; err != nil {
		return models.BetActionEvent{}, false, mapError(err)
	}
	return event, true, nil
}
