package repository

import (
	"context"
	"time"

	"surebet/backend/internal/models"
)

type UserRepository interface {
	GetByID(ctx context.Context, id string) (models.User, error)
	GetByEmail(ctx context.Context, email string) (models.User, error)
	List(ctx context.Context) ([]models.User, error)
	Upsert(ctx context.Context, user models.User) error
	UpdateLastLogin(ctx context.Context, id string, loggedAt time.Time) error
}

type RuntimeSettingRepository interface {
	ListByPrefix(ctx context.Context, prefix string) ([]models.RuntimeSetting, error)
	UpsertMany(ctx context.Context, settings []models.RuntimeSetting) error
}

type BetActionRepository interface {
	Create(ctx context.Context, action models.BetAction) (models.BetAction, bool, error)
	Update(ctx context.Context, action models.BetAction) error
	UpdateCAS(ctx context.Context, action models.BetAction, expectedVersion int64) (models.BetAction, error)
	TryAcquireLease(ctx context.Context, id, owner string, expectedVersion int64, now, expiresAt time.Time) (models.BetAction, bool, error)
	ReleaseLease(ctx context.Context, id, owner string, expectedVersion int64, now time.Time) (models.BetAction, error)
	TryReserveAccountStake(ctx context.Context, id, accountID, owner string, expectedVersion, stakeVND int64, now, expiresAt time.Time) (models.BetAction, bool, error)
	ReleaseAccountStake(ctx context.Context, id, accountID, owner string, expectedVersion int64, now time.Time) (models.BetAction, error)
	GetByID(ctx context.Context, id string) (models.BetAction, error)
	GetByIdempotencyKey(ctx context.Context, key string) (models.BetAction, error)
	List(ctx context.Context, status string, limit int) ([]models.BetAction, error)
}

type BetAttemptRepository interface {
	Create(ctx context.Context, attempt models.BetAttempt) (models.BetAttempt, bool, error)
	UpdateCAS(ctx context.Context, attempt models.BetAttempt, expectedVersion int64) (models.BetAttempt, error)
	GetByID(ctx context.Context, id string) (models.BetAttempt, error)
	GetByIdempotencyKey(ctx context.Context, key string) (models.BetAttempt, error)
	ListByAction(ctx context.Context, actionID string, limit int) ([]models.BetAttempt, error)
	ListByExposure(ctx context.Context, exposureID string, limit int) ([]models.BetAttempt, error)
}

type BetExposureRepository interface {
	Create(ctx context.Context, exposure models.BetExposure) (models.BetExposure, bool, error)
	UpdateCAS(ctx context.Context, exposure models.BetExposure, expectedVersion int64) (models.BetExposure, error)
	TryAcquireLease(ctx context.Context, id, owner string, expectedVersion int64, now, expiresAt time.Time) (models.BetExposure, bool, error)
	ReleaseLease(ctx context.Context, id, owner string, expectedVersion int64, now time.Time) (models.BetExposure, error)
	GetByID(ctx context.Context, id string) (models.BetExposure, error)
	GetByActionID(ctx context.Context, actionID string) (models.BetExposure, error)
	List(ctx context.Context, status string, limit int) ([]models.BetExposure, error)
	ListDue(ctx context.Context, now time.Time, limit int) ([]models.BetExposure, error)
	CommitJun88Ticket(
		ctx context.Context,
		action models.BetAction,
		expectedActionVersion int64,
		attempt models.BetAttempt,
		expectedAttemptVersion int64,
		exposure models.BetExposure,
		event models.BetActionEvent,
	) (models.BetExposure, bool, error)
}

type BetActionEventRepository interface {
	Append(ctx context.Context, event models.BetActionEvent) (models.BetActionEvent, bool, error)
	ListByAction(ctx context.Context, actionID string, afterSequence int64, limit int) ([]models.BetActionEvent, error)
}

var (
	ErrNotFound        = errNotFound("repository record not found")
	ErrVersionConflict = repositoryError("repository version conflict")
	ErrInvalidLease    = repositoryError("invalid repository lease")
)

type errNotFound string

func (e errNotFound) Error() string {
	return string(e)
}

type repositoryError string

func (e repositoryError) Error() string {
	return string(e)
}
