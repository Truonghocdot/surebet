package gormstore

import (
	"context"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"surebet/backend/internal/models"
	"surebet/backend/internal/repository"
)

type BetActionRepository struct {
	db *gorm.DB
}

func NewBetActionRepository(db *gorm.DB) *BetActionRepository {
	return &BetActionRepository{db: db}
}

func (r *BetActionRepository) Create(
	ctx context.Context,
	action models.BetAction,
) (models.BetAction, bool, error) {
	if action.Version <= 0 {
		action.Version = 1
	}
	result := r.db.WithContext(ctx).
		Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "idempotency_key"}},
			DoNothing: true,
		}).
		Create(&action)
	if result.Error != nil {
		return models.BetAction{}, false, mapError(result.Error)
	}
	if result.RowsAffected > 0 {
		return action, true, nil
	}

	existing, err := r.GetByIdempotencyKey(ctx, action.IdempotencyKey)
	return existing, false, err
}

func (r *BetActionRepository) Update(ctx context.Context, action models.BetAction) error {
	_, err := r.UpdateCAS(ctx, action, action.Version)
	return err
}

func (r *BetActionRepository) UpdateCAS(
	ctx context.Context,
	action models.BetAction,
	expectedVersion int64,
) (models.BetAction, error) {
	if expectedVersion <= 0 {
		return models.BetAction{}, repository.ErrVersionConflict
	}
	if action.UpdatedAt.IsZero() {
		action.UpdatedAt = time.Now().UTC()
	}
	nextVersion := expectedVersion + 1
	result := r.db.WithContext(ctx).
		Model(&models.BetAction{}).
		Where("id = ? AND version = ?", action.ID, expectedVersion).
		Updates(actionUpdateValues(action, nextVersion))
	if result.Error != nil {
		return models.BetAction{}, mapError(result.Error)
	}
	if result.RowsAffected != 1 {
		return models.BetAction{}, repository.ErrVersionConflict
	}
	action.Version = nextVersion
	return action, nil
}

func actionUpdateValues(action models.BetAction, nextVersion int64) map[string]any {
	return map[string]any{
		"status":                 action.Status,
		"expected_return":        action.ExpectedReturn,
		"legs":                   action.Legs,
		"events":                 action.Events,
		"exposure_open":          action.ExposureOpen,
		"exposure_id":            action.ExposureID,
		"reprice_revision":       action.RepriceRevision,
		"reserved_stake_vnd":     action.ReservedStakeVND,
		"reservation_expires_at": action.ReservationExpiresAt,
		"lease_owner":            action.LeaseOwner,
		"lease_expires_at":       action.LeaseExpiresAt,
		"completed_at":           action.CompletedAt,
		"error_code":             action.ErrorCode,
		"error_message":          action.ErrorMessage,
		"version":                nextVersion,
		"updated_at":             action.UpdatedAt,
	}
}

func (r *BetActionRepository) TryAcquireLease(
	ctx context.Context,
	id, owner string,
	expectedVersion int64,
	now, expiresAt time.Time,
) (models.BetAction, bool, error) {
	if id == "" || owner == "" || expectedVersion <= 0 || now.IsZero() || !expiresAt.After(now) {
		return models.BetAction{}, false, repository.ErrInvalidLease
	}
	now = now.UTC()
	expiresAt = expiresAt.UTC()
	result := r.db.WithContext(ctx).
		Model(&models.BetAction{}).
		Where("id = ? AND version = ?", id, expectedVersion).
		Where("lease_expires_at IS NULL OR lease_expires_at <= ? OR lease_owner = ?", now, owner).
		Updates(map[string]any{
			"lease_owner": owner, "lease_expires_at": expiresAt,
			"version": expectedVersion + 1, "updated_at": now,
		})
	if result.Error != nil {
		return models.BetAction{}, false, mapError(result.Error)
	}
	current, err := r.GetByID(ctx, id)
	if err != nil {
		return models.BetAction{}, false, err
	}
	return current, result.RowsAffected == 1, nil
}

func (r *BetActionRepository) ReleaseLease(
	ctx context.Context,
	id, owner string,
	expectedVersion int64,
	now time.Time,
) (models.BetAction, error) {
	if id == "" || owner == "" || expectedVersion <= 0 || now.IsZero() {
		return models.BetAction{}, repository.ErrInvalidLease
	}
	now = now.UTC()
	result := r.db.WithContext(ctx).
		Model(&models.BetAction{}).
		Where("id = ? AND version = ? AND lease_owner = ?", id, expectedVersion, owner).
		Updates(map[string]any{
			"lease_owner": "", "lease_expires_at": nil,
			"version": expectedVersion + 1, "updated_at": now,
		})
	if result.Error != nil {
		return models.BetAction{}, mapError(result.Error)
	}
	if result.RowsAffected != 1 {
		return models.BetAction{}, repository.ErrVersionConflict
	}
	return r.GetByID(ctx, id)
}

// TryReserveAccountStake serializes reservations with a transaction-scoped
// Postgres advisory lock. Locking only the action row is insufficient because
// two new actions for the same account would otherwise lock different rows.
// Reservations for an action that may already have reached a bookmaker remain
// exclusive until the action is explicitly resolved, even after its lease TTL.
func (r *BetActionRepository) TryReserveAccountStake(
	ctx context.Context,
	id, accountID, owner string,
	expectedVersion, stakeVND int64,
	now, expiresAt time.Time,
) (models.BetAction, bool, error) {
	if id == "" || accountID == "" || owner == "" || expectedVersion <= 0 || stakeVND <= 0 ||
		now.IsZero() || !expiresAt.After(now) {
		return models.BetAction{}, false, repository.ErrInvalidLease
	}
	now = now.UTC()
	expiresAt = expiresAt.UTC()
	var (
		stored   models.BetAction
		reserved bool
	)
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec(
			"SELECT pg_advisory_xact_lock(hashtextextended(?, 0))",
			accountID,
		).Error; err != nil {
			return mapError(err)
		}

		var current models.BetAction
		if err := tx.Where("id = ?", id).First(&current).Error; err != nil {
			return mapError(err)
		}
		if current.Version != expectedVersion || (current.AccountID != "" && current.AccountID != accountID) {
			return repository.ErrVersionConflict
		}

		var activeReservations int64
		if err := tx.Model(&models.BetAction{}).
			Where("account_id = ? AND id <> ?", accountID, id).
			Where("reserved_stake_vnd > 0").
			Where(
				"reservation_expires_at > ? OR status IN ?",
				now,
				[]string{
					"placing_jun88",
					"jun88_ticket_received",
					"placing_8xbet",
					"exposure_open",
					"submission_unknown",
				},
			).
			Where("completed_at IS NULL").
			Count(&activeReservations).Error; err != nil {
			return mapError(err)
		}
		if activeReservations > 0 {
			stored = current
			return nil
		}

		result := tx.Model(&models.BetAction{}).
			Where("id = ? AND version = ?", id, expectedVersion).
			Where("reservation_expires_at IS NULL OR reservation_expires_at <= ? OR lease_owner = ?", now, owner).
			Updates(map[string]any{
				"account_id": accountID, "reserved_stake_vnd": stakeVND,
				"reservation_expires_at": expiresAt,
				"lease_owner":            owner, "lease_expires_at": expiresAt,
				"version": expectedVersion + 1, "updated_at": now,
			})
		if result.Error != nil {
			return mapError(result.Error)
		}
		if result.RowsAffected != 1 {
			return repository.ErrVersionConflict
		}
		if err := tx.Where("id = ?", id).First(&stored).Error; err != nil {
			return mapError(err)
		}
		reserved = true
		return nil
	})
	return stored, reserved, err
}

func (r *BetActionRepository) ReleaseAccountStake(
	ctx context.Context,
	id, accountID, owner string,
	expectedVersion int64,
	now time.Time,
) (models.BetAction, error) {
	if id == "" || accountID == "" || owner == "" || expectedVersion <= 0 || now.IsZero() {
		return models.BetAction{}, repository.ErrInvalidLease
	}
	now = now.UTC()
	var stored models.BetAction
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec(
			"SELECT pg_advisory_xact_lock(hashtextextended(?, 0))",
			accountID,
		).Error; err != nil {
			return mapError(err)
		}
		result := tx.Model(&models.BetAction{}).
			Where(
				"id = ? AND account_id = ? AND version = ? AND lease_owner = ?",
				id, accountID, expectedVersion, owner,
			).
			Updates(map[string]any{
				"reserved_stake_vnd": 0, "reservation_expires_at": nil,
				"lease_owner": "", "lease_expires_at": nil,
				"version": expectedVersion + 1, "updated_at": now,
			})
		if result.Error != nil {
			return mapError(result.Error)
		}
		if result.RowsAffected != 1 {
			return repository.ErrVersionConflict
		}
		if err := tx.Where("id = ?", id).First(&stored).Error; err != nil {
			return mapError(err)
		}
		return nil
	})
	return stored, err
}

func (r *BetActionRepository) GetByID(ctx context.Context, id string) (models.BetAction, error) {
	var action models.BetAction
	err := r.db.WithContext(ctx).Where("id = ?", id).First(&action).Error
	return action, mapError(err)
}

func (r *BetActionRepository) GetByIdempotencyKey(ctx context.Context, key string) (models.BetAction, error) {
	var action models.BetAction
	err := r.db.WithContext(ctx).Where("idempotency_key = ?", key).First(&action).Error
	return action, mapError(err)
}

func (r *BetActionRepository) List(ctx context.Context, status string, limit int) ([]models.BetAction, error) {
	var actions []models.BetAction
	query := r.db.WithContext(ctx).Order("created_at desc")
	if status != "" {
		query = query.Where("status = ?", status)
	}
	if limit > 0 {
		query = query.Limit(limit)
	}
	if err := query.Find(&actions).Error; err != nil {
		return nil, err
	}
	return actions, nil
}
