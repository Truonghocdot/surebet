package gormstore

import (
	"context"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"surebet/backend/internal/models"
	"surebet/backend/internal/repository"
)

type BetAttemptRepository struct {
	db *gorm.DB
}

func NewBetAttemptRepository(db *gorm.DB) *BetAttemptRepository {
	return &BetAttemptRepository{db: db}
}

func (r *BetAttemptRepository) Create(
	ctx context.Context,
	attempt models.BetAttempt,
) (models.BetAttempt, bool, error) {
	if attempt.Version <= 0 {
		attempt.Version = 1
	}
	result := r.db.WithContext(ctx).
		Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "idempotency_key"}},
			DoNothing: true,
		}).
		Create(&attempt)
	if result.Error != nil {
		return models.BetAttempt{}, false, mapError(result.Error)
	}
	if result.RowsAffected == 1 {
		return attempt, true, nil
	}
	existing, err := r.GetByIdempotencyKey(ctx, attempt.IdempotencyKey)
	return existing, false, err
}

func (r *BetAttemptRepository) UpdateCAS(
	ctx context.Context,
	attempt models.BetAttempt,
	expectedVersion int64,
) (models.BetAttempt, error) {
	if expectedVersion <= 0 {
		return models.BetAttempt{}, repository.ErrVersionConflict
	}
	if attempt.UpdatedAt.IsZero() {
		attempt.UpdatedAt = time.Now().UTC()
	}
	nextVersion := expectedVersion + 1
	result := r.db.WithContext(ctx).
		Model(&models.BetAttempt{}).
		Where("id = ? AND version = ?", attempt.ID, expectedVersion).
		Updates(attemptUpdateValues(attempt, nextVersion))
	if result.Error != nil {
		return models.BetAttempt{}, mapError(result.Error)
	}
	if result.RowsAffected != 1 {
		return models.BetAttempt{}, repository.ErrVersionConflict
	}
	attempt.Version = nextVersion
	return attempt, nil
}

func (r *BetAttemptRepository) GetByID(ctx context.Context, id string) (models.BetAttempt, error) {
	var attempt models.BetAttempt
	err := r.db.WithContext(ctx).Where("id = ?", id).First(&attempt).Error
	return attempt, mapError(err)
}

func (r *BetAttemptRepository) GetByIdempotencyKey(
	ctx context.Context,
	key string,
) (models.BetAttempt, error) {
	var attempt models.BetAttempt
	err := r.db.WithContext(ctx).Where("idempotency_key = ?", key).First(&attempt).Error
	return attempt, mapError(err)
}

func (r *BetAttemptRepository) ListByAction(
	ctx context.Context,
	actionID string,
	limit int,
) ([]models.BetAttempt, error) {
	var attempts []models.BetAttempt
	query := r.db.WithContext(ctx).
		Where("action_id = ?", actionID).
		Order("attempt_number asc, created_at asc")
	if limit > 0 {
		query = query.Limit(limit)
	}
	err := query.Find(&attempts).Error
	return attempts, mapError(err)
}

func (r *BetAttemptRepository) ListByExposure(
	ctx context.Context,
	exposureID string,
	limit int,
) ([]models.BetAttempt, error) {
	var attempts []models.BetAttempt
	query := r.db.WithContext(ctx).
		Where("exposure_id = ?", exposureID).
		Order("attempt_number asc, created_at asc")
	if limit > 0 {
		query = query.Limit(limit)
	}
	err := query.Find(&attempts).Error
	return attempts, mapError(err)
}

func attemptUpdateValues(attempt models.BetAttempt, nextVersion int64) map[string]any {
	return map[string]any{
		"exposure_id":          attempt.ExposureID,
		"status":               attempt.Status,
		"result":               attempt.Result,
		"request_id":           attempt.RequestID,
		"session_id":           attempt.SessionID,
		"session_generation":   attempt.SessionGeneration,
		"provider_reference":   attempt.ProviderReference,
		"prepare_id":           attempt.PrepareID,
		"slip_fingerprint":     attempt.SlipFingerprint,
		"quote_revision":       attempt.QuoteRevision,
		"odds_format":          attempt.OddsFormat,
		"raw_odds":             attempt.RawOdds,
		"expected_odds":        attempt.ExpectedOdds,
		"submitted_odds":       attempt.SubmittedOdds,
		"offered_odds":         attempt.OfferedOdds,
		"accepted_odds":        attempt.AcceptedOdds,
		"requested_stake_vnd":  attempt.RequestedStakeVND,
		"accepted_stake_vnd":   attempt.AcceptedStakeVND,
		"minimum_stake_vnd":    attempt.MinimumStakeVND,
		"maximum_stake_vnd":    attempt.MaximumStakeVND,
		"stake_increment_vnd":  attempt.StakeIncrementVND,
		"balance_vnd":          attempt.BalanceVND,
		"ticket_id":            attempt.TicketID,
		"raw_response_hash":    attempt.RawResponseHash,
		"expires_at":           attempt.ExpiresAt,
		"observed_at":          attempt.ObservedAt,
		"submit_started_at":    attempt.SubmitStartedAt,
		"response_received_at": attempt.ResponseReceivedAt,
		"reconciled_at":        attempt.ReconciledAt,
		"error_code":           attempt.ErrorCode,
		"error_message":        attempt.ErrorMessage,
		"version":              nextVersion,
		"updated_at":           attempt.UpdatedAt,
	}
}
