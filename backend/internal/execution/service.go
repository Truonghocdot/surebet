package execution

import (
	"context"
	"time"

	"surebet/backend/internal/models"
)

type Request struct {
	Order       models.BetOrder
	Opportunity models.SurebetOpportunity
	TriggeredBy string
	RequestedAt time.Time
}

type Result struct {
	OrderID           string            `json:"order_id"`
	Status            models.BetStatus  `json:"status"`
	Accepted          bool              `json:"accepted"`
	BookmakerID       string            `json:"bookmaker_id"`
	ExternalReference string            `json:"external_reference"`
	Reason            string            `json:"reason"`
	Metadata          map[string]string `json:"metadata"`
	CompletedAt       time.Time         `json:"completed_at"`
}

type PlaceBetCommand struct {
	AccountID   string
	SessionID   string
	BookmakerID string
	FixtureID   string
	MarketID    string
	OutcomeID   string
	Stake       float64
	Odds        float64
}

type ProviderReceipt struct {
	ExternalBetID string  `json:"external_bet_id"`
	Accepted      bool    `json:"accepted"`
	Reason        string  `json:"reason"`
	AppliedOdds   float64 `json:"applied_odds"`
	AppliedStake  float64 `json:"applied_stake"`
}

type LockHandle interface {
	Release(ctx context.Context) error
}

type LockManager interface {
	LockAccount(ctx context.Context, accountID string, ttl time.Duration) (LockHandle, error)
	LockFixture(ctx context.Context, fixtureID string, ttl time.Duration) (LockHandle, error)
	LockMarket(ctx context.Context, marketID string, ttl time.Duration) (LockHandle, error)
}

type BookmakerAdapter interface {
	PlaceBet(ctx context.Context, command PlaceBetCommand) (ProviderReceipt, error)
}

type Engine interface {
	Execute(ctx context.Context, request Request) (Result, error)
}
