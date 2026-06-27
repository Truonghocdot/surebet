package autobet

import (
	"context"
	"time"

	"surebet/backend/internal/models"
)

type Candidate struct {
	Opportunity models.SurebetOpportunity
	Account     models.Account
	RequestedBy string
	ManualOnly  bool
	RequestedAt time.Time
}

type Decision struct {
	Status               models.BetStatus `json:"status"`
	RequiresConfirmation bool             `json:"requires_confirmation"`
	Reasons              []string         `json:"reasons"`
}

type Coordinator interface {
	Evaluate(ctx context.Context, candidate Candidate) (Decision, error)
	Queue(ctx context.Context, candidate Candidate) error
}
