package validator

import (
	"context"
	"time"

	"surebet/backend/internal/models"
)

type StepName string

const (
	CheckSurebetStillExists   StepName = "SUREBET_STILL_EXISTS"
	CheckLatestOddsFetched    StepName = "LATEST_ODDS_FETCHED"
	CheckOddsNotChanged       StepName = "ODDS_NOT_CHANGED"
	CheckProfitThreshold      StepName = "PROFIT_THRESHOLD"
	CheckBookmakerAvailable   StepName = "BOOKMAKER_AVAILABLE"
	CheckAccountLoggedIn      StepName = "ACCOUNT_LOGGED_IN"
	CheckBalanceAvailable     StepName = "BALANCE_AVAILABLE"
	CheckStakeValid           StepName = "STAKE_VALID"
	CheckMarketNotSuspended   StepName = "MARKET_NOT_SUSPENDED"
	CheckDuplicateOrder       StepName = "DUPLICATE_ORDER"
	CheckRiskScore            StepName = "RISK_SCORE"
	CheckFeatureSwitchEnabled StepName = "FEATURE_SWITCH_ENABLED"
)

var DefaultOrder = []StepName{
	CheckSurebetStillExists,
	CheckLatestOddsFetched,
	CheckOddsNotChanged,
	CheckProfitThreshold,
	CheckBookmakerAvailable,
	CheckAccountLoggedIn,
	CheckBalanceAvailable,
	CheckStakeValid,
	CheckMarketNotSuspended,
	CheckDuplicateOrder,
	CheckRiskScore,
	CheckFeatureSwitchEnabled,
}

type Input struct {
	Order       models.BetOrder
	Opportunity models.SurebetOpportunity
	Account     models.Account
	Quotes      []models.OddsQuote
}

type Violation struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type StepResult struct {
	Name       StepName    `json:"name"`
	Passed     bool        `json:"passed"`
	Violations []Violation `json:"violations"`
}

type Result struct {
	OrderID     string       `json:"order_id"`
	Passed      bool         `json:"passed"`
	StepResults []StepResult `json:"step_results"`
	EvaluatedAt time.Time    `json:"evaluated_at"`
}

type Step interface {
	Name() StepName
	Validate(ctx context.Context, input Input) (StepResult, error)
}

type Pipeline interface {
	Validate(ctx context.Context, input Input) (Result, error)
}
