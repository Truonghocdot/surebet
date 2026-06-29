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

type AccountRepository interface {
	GetByID(ctx context.Context, id string) (models.Account, error)
	GetByExternalRef(ctx context.Context, externalRef string) (models.Account, error)
	List(ctx context.Context) ([]models.Account, error)
	ListByBookmaker(ctx context.Context, bookmakerID string) ([]models.Account, error)
	Upsert(ctx context.Context, account models.Account) error
	UpdateBalance(ctx context.Context, accountID string, balance float64, updatedAt time.Time) error
}

type BookmakerRepository interface {
	GetByCode(ctx context.Context, code string) (models.Bookmaker, error)
	List(ctx context.Context) ([]models.Bookmaker, error)
	ListEnabled(ctx context.Context) ([]models.Bookmaker, error)
	Upsert(ctx context.Context, bookmaker models.Bookmaker) error
}

type SessionRepository interface {
	Upsert(ctx context.Context, session models.Session) error
	GetActiveByAccountID(ctx context.Context, accountID string) (models.Session, error)
}

type BetOrderRepository interface {
	Create(ctx context.Context, order models.BetOrder, legs []models.BetOrderLeg) error
	GetByID(ctx context.Context, id string) (models.BetOrder, error)
	UpdateStatus(ctx context.Context, id string, status models.BetStatus, updatedAt time.Time) error
	FindDuplicateByFingerprint(ctx context.Context, fingerprint string) (models.BetOrder, error)
}

type BetResultRepository interface {
	Save(ctx context.Context, result models.BetResult) error
}

type AuditLogRepository interface {
	Append(ctx context.Context, entry models.AuditLog) error
}

type FeatureFlagRepository interface {
	List(ctx context.Context) ([]models.FeatureFlag, error)
	IsEnabled(ctx context.Context, name string, scope map[string]string) (bool, error)
}

type ConfigurationRepository interface {
	GetByKey(ctx context.Context, key string) (models.Configuration, error)
	List(ctx context.Context, prefix string) ([]models.Configuration, error)
	Upsert(ctx context.Context, configuration models.Configuration) error
}

type OddsSnapshotRepository interface {
	Upsert(ctx context.Context, quotes []models.OddsQuote) error
	ListByFixture(ctx context.Context, fixtureID string) ([]models.OddsQuote, error)
}

type SurebetRepository interface {
	UpsertCurrent(ctx context.Context, opportunities []models.SurebetOpportunity) error
	GetCurrentByID(ctx context.Context, id string) (models.SurebetOpportunity, error)
}

type HistoryRepository interface {
	AppendOddsHistory(ctx context.Context, records []models.OddsHistory) error
	AppendSurebetHistory(ctx context.Context, records []models.SurebetHistory) error
	AppendExecutionHistory(ctx context.Context, records []models.ExecutionHistory) error
	AppendCrawlerLatency(ctx context.Context, records []models.CrawlerLatency) error
	AppendOddsLatency(ctx context.Context, records []models.OddsLatency) error
	AppendRiskHistory(ctx context.Context, records []models.RiskHistory) error
}

type LockRepository interface {
	Acquire(ctx context.Context, key string, ttl time.Duration) (Lock, error)
}

type Lock interface {
	Key() string
	Release(ctx context.Context) error
}

var ErrNotFound = errNotFound("repository record not found")

type errNotFound string

func (e errNotFound) Error() string {
	return string(e)
}
