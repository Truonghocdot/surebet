package dto

import (
	"time"

	"surebet/backend/internal/models"
)

type CreateManualBetRequest struct {
	OpportunityID string `json:"opportunity_id"`
	UserID        string `json:"user_id"`
}

type BetOrderView struct {
	ID                   string               `json:"id"`
	OpportunityID        string               `json:"opportunity_id"`
	Status               models.BetStatus     `json:"status"`
	Mode                 models.ExecutionMode `json:"mode"`
	RequiresConfirmation bool                 `json:"requires_confirmation"`
	ProfitPercentage     float64              `json:"profit_percentage"`
	ExpectedReturn       float64              `json:"expected_return"`
	RiskScore            int                  `json:"risk_score"`
	CreatedAt            time.Time            `json:"created_at"`
	CompletedAt          *time.Time           `json:"completed_at,omitempty"`
}

type FeatureFlagView struct {
	Name        string    `json:"name"`
	IsEnabled   bool      `json:"is_enabled"`
	ScopeType   string    `json:"scope_type"`
	ScopeValue  string    `json:"scope_value"`
	EffectiveAt time.Time `json:"effective_at"`
}

type ValidationResultView struct {
	Passed      bool      `json:"passed"`
	Step        string    `json:"step"`
	Reason      string    `json:"reason"`
	EvaluatedAt time.Time `json:"evaluated_at"`
}
