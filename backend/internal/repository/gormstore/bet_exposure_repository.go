package gormstore

import (
	"context"
	"errors"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"surebet/backend/internal/models"
	"surebet/backend/internal/repository"
)

type BetExposureRepository struct {
	db *gorm.DB
}

func NewBetExposureRepository(db *gorm.DB) *BetExposureRepository {
	return &BetExposureRepository{db: db}
}

func (r *BetExposureRepository) Create(
	ctx context.Context,
	exposure models.BetExposure,
) (models.BetExposure, bool, error) {
	if exposure.Version <= 0 {
		exposure.Version = 1
	}
	result := r.db.WithContext(ctx).
		Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "idempotency_key"}},
			DoNothing: true,
		}).
		Create(&exposure)
	if result.Error != nil {
		return models.BetExposure{}, false, mapError(result.Error)
	}
	if result.RowsAffected == 1 {
		return exposure, true, nil
	}
	var existing models.BetExposure
	err := r.db.WithContext(ctx).
		Where("idempotency_key = ?", exposure.IdempotencyKey).
		First(&existing).Error
	return existing, false, mapError(err)
}

func (r *BetExposureRepository) UpdateCAS(
	ctx context.Context,
	exposure models.BetExposure,
	expectedVersion int64,
) (models.BetExposure, error) {
	if expectedVersion <= 0 {
		return models.BetExposure{}, repository.ErrVersionConflict
	}
	if exposure.UpdatedAt.IsZero() {
		exposure.UpdatedAt = time.Now().UTC()
	}
	nextVersion := expectedVersion + 1
	result := r.db.WithContext(ctx).
		Model(&models.BetExposure{}).
		Where("id = ? AND version = ?", exposure.ID, expectedVersion).
		Updates(exposureUpdateValues(exposure, nextVersion))
	if result.Error != nil {
		return models.BetExposure{}, mapError(result.Error)
	}
	if result.RowsAffected != 1 {
		return models.BetExposure{}, repository.ErrVersionConflict
	}
	exposure.Version = nextVersion
	return exposure, nil
}

func (r *BetExposureRepository) TryAcquireLease(
	ctx context.Context,
	id, owner string,
	expectedVersion int64,
	now, expiresAt time.Time,
) (models.BetExposure, bool, error) {
	if id == "" || owner == "" || expectedVersion <= 0 || now.IsZero() || !expiresAt.After(now) {
		return models.BetExposure{}, false, repository.ErrInvalidLease
	}
	now = now.UTC()
	expiresAt = expiresAt.UTC()
	result := r.db.WithContext(ctx).
		Model(&models.BetExposure{}).
		Where("id = ? AND version = ?", id, expectedVersion).
		Where("lease_expires_at IS NULL OR lease_expires_at <= ? OR lease_owner = ?", now, owner).
		Updates(map[string]any{
			"lease_owner": owner, "lease_expires_at": expiresAt,
			"version": expectedVersion + 1, "updated_at": now,
		})
	if result.Error != nil {
		return models.BetExposure{}, false, mapError(result.Error)
	}
	current, err := r.GetByID(ctx, id)
	if err != nil {
		return models.BetExposure{}, false, err
	}
	return current, result.RowsAffected == 1, nil
}

func (r *BetExposureRepository) ReleaseLease(
	ctx context.Context,
	id, owner string,
	expectedVersion int64,
	now time.Time,
) (models.BetExposure, error) {
	if id == "" || owner == "" || expectedVersion <= 0 || now.IsZero() {
		return models.BetExposure{}, repository.ErrInvalidLease
	}
	now = now.UTC()
	result := r.db.WithContext(ctx).
		Model(&models.BetExposure{}).
		Where("id = ? AND version = ? AND lease_owner = ?", id, expectedVersion, owner).
		Updates(map[string]any{
			"lease_owner": "", "lease_expires_at": nil,
			"version": expectedVersion + 1, "updated_at": now,
		})
	if result.Error != nil {
		return models.BetExposure{}, mapError(result.Error)
	}
	if result.RowsAffected != 1 {
		return models.BetExposure{}, repository.ErrVersionConflict
	}
	return r.GetByID(ctx, id)
}

func (r *BetExposureRepository) GetByID(ctx context.Context, id string) (models.BetExposure, error) {
	var exposure models.BetExposure
	err := r.db.WithContext(ctx).Where("id = ?", id).First(&exposure).Error
	return exposure, mapError(err)
}

func (r *BetExposureRepository) GetByActionID(
	ctx context.Context,
	actionID string,
) (models.BetExposure, error) {
	var exposure models.BetExposure
	err := r.db.WithContext(ctx).Where("action_id = ?", actionID).First(&exposure).Error
	return exposure, mapError(err)
}

func (r *BetExposureRepository) List(
	ctx context.Context,
	status string,
	limit int,
) ([]models.BetExposure, error) {
	var exposures []models.BetExposure
	query := r.db.WithContext(ctx).Order("opened_at desc")
	if status != "" {
		query = query.Where("status = ?", status)
	}
	if limit > 0 {
		query = query.Limit(limit)
	}
	if err := query.Find(&exposures).Error; err != nil {
		return nil, mapError(err)
	}
	return exposures, nil
}

// ListDue deliberately excludes submission_unknown: reconciliation must
// resolve whether a ticket exists before the hedge matcher may run again.
func (r *BetExposureRepository) ListDue(
	ctx context.Context,
	now time.Time,
	limit int,
) ([]models.BetExposure, error) {
	var exposures []models.BetExposure
	query := r.db.WithContext(ctx).
		Where("status = ?", "exposure_open").
		Where("next_evaluation_at IS NULL OR next_evaluation_at <= ?", now.UTC()).
		Where("lease_expires_at IS NULL OR lease_expires_at <= ?", now.UTC()).
		Order("opened_at asc")
	if limit > 0 {
		query = query.Limit(limit)
	}
	if err := query.Find(&exposures).Error; err != nil {
		return nil, mapError(err)
	}
	return exposures, nil
}

// CommitJun88Ticket atomically persists the accepted Jun88 attempt, opens the
// durable exposure, and points the action at it. A successful return is the
// persistence barrier that must precede any 8xbet commit command.
func (r *BetExposureRepository) CommitJun88Ticket(
	ctx context.Context,
	action models.BetAction,
	expectedActionVersion int64,
	attempt models.BetAttempt,
	expectedAttemptVersion int64,
	exposure models.BetExposure,
	event models.BetActionEvent,
) (models.BetExposure, bool, error) {
	if expectedActionVersion <= 0 || expectedAttemptVersion <= 0 ||
		action.ID == "" || exposure.ActionID != action.ID || attempt.ActionID != action.ID ||
		(action.Status != "jun88_ticket_received" && action.Status != "exposure_open") ||
		action.AccountID == "" || action.AccountID != exposure.AccountID ||
		attempt.AccountID != exposure.AccountID ||
		action.ExposureID != exposure.ID || !action.ExposureOpen || action.CompletedAt != nil ||
		attempt.ID != exposure.Jun88AttemptID || attempt.ExposureID != exposure.ID ||
		attempt.Phase != "commit" || attempt.BookmakerID != "jun88" ||
		attempt.LegID != exposure.Jun88LegID ||
		attempt.ProviderReference != exposure.Jun88ProviderReference ||
		attempt.Status != "response_received" || attempt.Result != "ticket_accepted" ||
		attempt.TicketID == "" || attempt.TicketID != exposure.Jun88TicketID ||
		attempt.AcceptedStakeVND != exposure.Jun88StakeVND ||
		attempt.AcceptedOdds != exposure.Jun88AcceptedOdds || exposure.Status != "exposure_open" ||
		exposure.Currency != "VND" || exposure.HedgeBookmakerID != "8xbet" ||
		exposure.HedgeProviderReference == "" || exposure.HedgeStakeIncrementVND <= 0 ||
		event.ActionID != action.ID || event.ExposureID != exposure.ID ||
		event.IdempotencyKey == "" {
		return models.BetExposure{}, false, repository.ErrVersionConflict
	}

	var committed models.BetExposure
	created := false
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var existing models.BetExposure
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("action_id = ?", action.ID).
			First(&existing).Error
		if err == nil {
			if existing.IdempotencyKey != exposure.IdempotencyKey ||
				existing.Jun88TicketID != exposure.Jun88TicketID {
				return repository.ErrVersionConflict
			}
			committed = existing
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return mapError(err)
		}

		if action.UpdatedAt.IsZero() {
			action.UpdatedAt = time.Now().UTC()
		}
		result := tx.Model(&models.BetAction{}).
			Where("id = ? AND version = ?", action.ID, expectedActionVersion).
			Updates(actionUpdateValues(action, expectedActionVersion+1))
		if result.Error != nil {
			return mapError(result.Error)
		}
		if result.RowsAffected != 1 {
			return repository.ErrVersionConflict
		}

		if attempt.UpdatedAt.IsZero() {
			attempt.UpdatedAt = action.UpdatedAt
		}
		result = tx.Model(&models.BetAttempt{}).
			Where("id = ? AND version = ?", attempt.ID, expectedAttemptVersion).
			Updates(attemptUpdateValues(attempt, expectedAttemptVersion+1))
		if result.Error != nil {
			return mapError(result.Error)
		}
		if result.RowsAffected != 1 {
			return repository.ErrVersionConflict
		}

		if exposure.Version <= 0 {
			exposure.Version = 1
		}
		if err := tx.Create(&exposure).Error; err != nil {
			return mapError(err)
		}
		if _, _, err := appendBetActionEvent(tx, event); err != nil {
			return err
		}
		committed = exposure
		created = true
		return nil
	})
	return committed, created, err
}

func exposureUpdateValues(exposure models.BetExposure, nextVersion int64) map[string]any {
	return map[string]any{
		"status":                     exposure.Status,
		"lease_owner":                exposure.LeaseOwner,
		"lease_expires_at":           exposure.LeaseExpiresAt,
		"hedge_minimum_stake_vnd":    exposure.HedgeMinimumStakeVND,
		"hedge_maximum_stake_vnd":    exposure.HedgeMaximumStakeVND,
		"hedge_stake_increment_vnd":  exposure.HedgeStakeIncrementVND,
		"current_hedge_odds":         exposure.CurrentHedgeOdds,
		"required_hedge_stake_vnd":   exposure.RequiredHedgeStakeVND,
		"projected_jun_profit_vnd":   exposure.ProjectedJunProfitVND,
		"projected_hedge_profit_vnd": exposure.ProjectedHedgeProfitVND,
		"last_quote_revision":        exposure.LastQuoteRevision,
		"last_quote_observed_at":     exposure.LastQuoteObservedAt,
		"next_evaluation_at":         exposure.NextEvaluationAt,
		"hedge_attempt_id":           exposure.HedgeAttemptID,
		"hedge_ticket_id":            exposure.HedgeTicketID,
		"hedge_accepted_odds":        exposure.HedgeAcceptedOdds,
		"hedge_accepted_stake_vnd":   exposure.HedgeAcceptedStakeVND,
		"hedge_accepted_at":          exposure.HedgeAcceptedAt,
		"completed_at":               exposure.CompletedAt,
		"closed_at":                  exposure.ClosedAt,
		"market_closed_at":           exposure.MarketClosedAt,
		"last_failure_code":          exposure.LastFailureCode,
		"last_failure_message":       exposure.LastFailureMessage,
		"version":                    nextVersion,
		"updated_at":                 exposure.UpdatedAt,
	}
}
