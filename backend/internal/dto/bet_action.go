package dto

import (
	"encoding/json"
	"time"
)

type BetActionLegView struct {
	LegID                 string    `json:"leg_id"`
	Sequence              int       `json:"sequence"`
	BookmakerID           string    `json:"bookmaker_id"`
	LobbyID               string    `json:"lobby_id"`
	FixtureID             string    `json:"fixture_id"`
	MarketID              string    `json:"market_id"`
	OutcomeID             string    `json:"outcome_id"`
	OutcomeName           string    `json:"outcome_name"`
	ProviderReference     string    `json:"provider_reference,omitempty"`
	ConfirmedOdds         float64   `json:"confirmed_odds"`
	SelectedOdds          float64   `json:"selected_odds,omitempty"`
	AvailableStake        float64   `json:"available_stake,omitempty"`
	StakeVND              int64     `json:"stake_vnd"`
	Status                string    `json:"status"`
	TicketID              string    `json:"ticket_id,omitempty"`
	AcceptedOdds          float64   `json:"accepted_odds,omitempty"`
	OfferedOdds           float64   `json:"offered_odds,omitempty"`
	OfferedPairEligible   *bool     `json:"offered_pair_eligible,omitempty"`
	OfferedExpectedReturn float64   `json:"offered_expected_return,omitempty"`
	ConfirmationRequired  bool      `json:"confirmation_required,omitempty"`
	ObservedAt            time.Time `json:"observed_at,omitempty"`
	Error                 string    `json:"error,omitempty"`
}

type BetActionEventView struct {
	Sequence    int       `json:"sequence"`
	Type        string    `json:"type"`
	Status      string    `json:"status"`
	BookmakerID string    `json:"bookmaker_id,omitempty"`
	Message     string    `json:"message,omitempty"`
	OccurredAt  time.Time `json:"occurred_at"`
}

type BetActionView struct {
	ActionID             string               `json:"action_id"`
	IdempotencyKey       string               `json:"idempotency_key"`
	OpportunityID        string               `json:"opportunity_id"`
	AccountID            string               `json:"account_id,omitempty"`
	ConfirmationRevision string               `json:"confirmation_revision,omitempty"`
	Mode                 string               `json:"mode"`
	Status               string               `json:"status"`
	Currency             string               `json:"currency"`
	TotalStakeVND        int64                `json:"total_stake_vnd"`
	ExpectedReturn       float64              `json:"expected_return"`
	Legs                 []BetActionLegView   `json:"legs"`
	Events               []BetActionEventView `json:"events"`
	ExposureOpen         bool                 `json:"exposure_open"`
	ExposureID           string               `json:"exposure_id,omitempty"`
	RepriceRevision      int                  `json:"reprice_revision"`
	ReservedStakeVND     int64                `json:"reserved_stake_vnd"`
	ReservationExpiresAt *time.Time           `json:"reservation_expires_at,omitempty"`
	Version              int64                `json:"version"`
	LeaseOwner           string               `json:"lease_owner,omitempty"`
	LeaseExpiresAt       *time.Time           `json:"lease_expires_at,omitempty"`
	CreatedAt            time.Time            `json:"created_at"`
	UpdatedAt            time.Time            `json:"updated_at"`
	CompletedAt          *time.Time           `json:"completed_at,omitempty"`
	ErrorCode            string               `json:"error_code,omitempty"`
	ErrorMessage         string               `json:"error_message,omitempty"`
}

type BetAttemptView struct {
	AttemptID          string     `json:"attempt_id"`
	IdempotencyKey     string     `json:"idempotency_key"`
	ActionID           string     `json:"action_id"`
	ExposureID         string     `json:"exposure_id,omitempty"`
	AccountID          string     `json:"account_id,omitempty"`
	AttemptNumber      int        `json:"attempt_number"`
	Phase              string     `json:"phase"`
	Status             string     `json:"status"`
	Result             string     `json:"result,omitempty"`
	RequestID          string     `json:"request_id,omitempty"`
	SessionID          string     `json:"session_id,omitempty"`
	SessionGeneration  string     `json:"session_generation,omitempty"`
	LegID              string     `json:"leg_id"`
	CollectorID        string     `json:"collector_id"`
	BookmakerID        string     `json:"bookmaker_id"`
	LobbyID            string     `json:"lobby_id"`
	FixtureID          string     `json:"fixture_id"`
	MarketID           string     `json:"market_id"`
	OutcomeID          string     `json:"outcome_id"`
	ProviderReference  string     `json:"provider_reference,omitempty"`
	PrepareID          string     `json:"prepare_id,omitempty"`
	SlipFingerprint    string     `json:"slip_fingerprint,omitempty"`
	QuoteRevision      string     `json:"quote_revision,omitempty"`
	OddsFormat         string     `json:"odds_format,omitempty"`
	RawOdds            float64    `json:"raw_odds,omitempty"`
	ExpectedOdds       float64    `json:"expected_odds,omitempty"`
	SubmittedOdds      float64    `json:"submitted_odds,omitempty"`
	OfferedOdds        float64    `json:"offered_odds,omitempty"`
	AcceptedOdds       float64    `json:"accepted_odds,omitempty"`
	RequestedStakeVND  int64      `json:"requested_stake_vnd,omitempty"`
	AcceptedStakeVND   int64      `json:"accepted_stake_vnd,omitempty"`
	MinimumStakeVND    int64      `json:"minimum_stake_vnd,omitempty"`
	MaximumStakeVND    int64      `json:"maximum_stake_vnd,omitempty"`
	StakeIncrementVND  int64      `json:"stake_increment_vnd,omitempty"`
	BalanceVND         int64      `json:"balance_vnd,omitempty"`
	TicketID           string     `json:"ticket_id,omitempty"`
	RawResponseHash    string     `json:"raw_response_hash,omitempty"`
	ExpiresAt          *time.Time `json:"expires_at,omitempty"`
	ObservedAt         *time.Time `json:"observed_at,omitempty"`
	SubmitStartedAt    *time.Time `json:"submit_started_at,omitempty"`
	ResponseReceivedAt *time.Time `json:"response_received_at,omitempty"`
	ReconciledAt       *time.Time `json:"reconciled_at,omitempty"`
	Version            int64      `json:"version"`
	ErrorCode          string     `json:"error_code,omitempty"`
	ErrorMessage       string     `json:"error_message,omitempty"`
	CreatedAt          time.Time  `json:"created_at"`
	UpdatedAt          time.Time  `json:"updated_at"`
}

type BetExposureView struct {
	ExposureID              string     `json:"exposure_id"`
	IdempotencyKey          string     `json:"idempotency_key"`
	ActionID                string     `json:"action_id"`
	AccountID               string     `json:"account_id"`
	Status                  string     `json:"status"`
	Currency                string     `json:"currency"`
	Version                 int64      `json:"version"`
	LeaseOwner              string     `json:"lease_owner,omitempty"`
	LeaseExpiresAt          *time.Time `json:"lease_expires_at,omitempty"`
	Jun88AttemptID          string     `json:"jun88_attempt_id"`
	Jun88TicketID           string     `json:"jun88_ticket_id"`
	Jun88LegID              string     `json:"jun88_leg_id"`
	Jun88FixtureID          string     `json:"jun88_fixture_id"`
	Jun88MarketID           string     `json:"jun88_market_id"`
	Jun88OutcomeID          string     `json:"jun88_outcome_id"`
	Jun88ProviderReference  string     `json:"jun88_provider_reference"`
	Jun88AcceptedOdds       float64    `json:"jun88_accepted_odds"`
	Jun88StakeVND           int64      `json:"jun88_stake_vnd"`
	Jun88AcceptedAt         time.Time  `json:"jun88_accepted_at"`
	HedgeBookmakerID        string     `json:"hedge_bookmaker_id"`
	HedgeLegID              string     `json:"hedge_leg_id"`
	HedgeFixtureID          string     `json:"hedge_fixture_id"`
	HedgeMarketID           string     `json:"hedge_market_id"`
	HedgeOutcomeID          string     `json:"hedge_outcome_id"`
	HedgeProviderReference  string     `json:"hedge_provider_reference"`
	MaximumTotalStakeVND    int64      `json:"maximum_total_stake_vnd"`
	HedgeMinimumStakeVND    int64      `json:"hedge_minimum_stake_vnd,omitempty"`
	HedgeMaximumStakeVND    int64      `json:"hedge_maximum_stake_vnd,omitempty"`
	HedgeStakeIncrementVND  int64      `json:"hedge_stake_increment_vnd"`
	CurrentHedgeOdds        float64    `json:"current_hedge_odds,omitempty"`
	RequiredHedgeStakeVND   int64      `json:"required_hedge_stake_vnd,omitempty"`
	ProjectedJunProfitVND   int64      `json:"projected_jun_profit_vnd,omitempty"`
	ProjectedHedgeProfitVND int64      `json:"projected_hedge_profit_vnd,omitempty"`
	LastQuoteRevision       string     `json:"last_quote_revision,omitempty"`
	LastQuoteObservedAt     *time.Time `json:"last_quote_observed_at,omitempty"`
	NextEvaluationAt        *time.Time `json:"next_evaluation_at,omitempty"`
	HedgeAttemptID          string     `json:"hedge_attempt_id,omitempty"`
	HedgeTicketID           string     `json:"hedge_ticket_id,omitempty"`
	HedgeAcceptedOdds       float64    `json:"hedge_accepted_odds,omitempty"`
	HedgeAcceptedStakeVND   int64      `json:"hedge_accepted_stake_vnd,omitempty"`
	HedgeAcceptedAt         *time.Time `json:"hedge_accepted_at,omitempty"`
	OpenedAt                time.Time  `json:"opened_at"`
	CompletedAt             *time.Time `json:"completed_at,omitempty"`
	ClosedAt                *time.Time `json:"closed_at,omitempty"`
	MarketClosedAt          *time.Time `json:"market_closed_at,omitempty"`
	LastFailureCode         string     `json:"last_failure_code,omitempty"`
	LastFailureMessage      string     `json:"last_failure_message,omitempty"`
	CreatedAt               time.Time  `json:"created_at"`
	UpdatedAt               time.Time  `json:"updated_at"`
}

type BetActionJournalEventView struct {
	EventID     string          `json:"event_id"`
	ActionID    string          `json:"action_id"`
	ExposureID  string          `json:"exposure_id,omitempty"`
	Sequence    int64           `json:"sequence"`
	Type        string          `json:"type"`
	Status      string          `json:"status"`
	BookmakerID string          `json:"bookmaker_id,omitempty"`
	Message     string          `json:"message,omitempty"`
	Metadata    json.RawMessage `json:"metadata"`
	OccurredAt  time.Time       `json:"occurred_at"`
}

// ReconcileBetActionRequest guards an operator-triggered reconciliation with
// the action version they inspected. The collector is only asked to reconcile
// the original idempotency key; this endpoint never repeats a commit command.
type ReconcileBetActionRequest struct {
	ExpectedVersion int64 `json:"expected_version" binding:"required,gt=0"`
}

// ManualExposureResolutionRequest records an operational decision about an
// already-open Jun88 exposure. A ticket_accepted resolution additionally
// requires all immutable 8xbet ticket evidence fields below.
type ManualExposureResolutionRequest struct {
	Resolution        string     `json:"resolution" binding:"required"`
	ExpectedVersion   int64      `json:"expected_version" binding:"required,gt=0"`
	Reason            string     `json:"reason" binding:"required"`
	AttemptID         string     `json:"attempt_id,omitempty"`
	TicketID          string     `json:"ticket_id,omitempty"`
	ProviderReference string     `json:"provider_reference,omitempty"`
	AcceptedOdds      float64    `json:"accepted_odds,omitempty"`
	AcceptedStakeVND  int64      `json:"accepted_stake_vnd,omitempty"`
	AcceptedAt        *time.Time `json:"accepted_at,omitempty"`
	MarketClosedAt    *time.Time `json:"market_closed_at,omitempty"`
}
