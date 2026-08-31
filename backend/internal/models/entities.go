package models

import "time"

type BaseModel struct {
	ID        string     `json:"id" gorm:"primaryKey"`
	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt time.Time  `json:"updated_at"`
	DeletedAt *time.Time `json:"deleted_at,omitempty"`
}

type User struct {
	BaseModel
	Email        string     `json:"email" gorm:"uniqueIndex;not null"`
	Password     string     `json:"-" gorm:"column:password"`
	PasswordHash string     `json:"-" gorm:"not null"`
	FullName     string     `json:"full_name"`
	Role         string     `json:"role"`
	IsActive     bool       `json:"is_active"`
	Locale       string     `json:"locale"`
	Timezone     string     `json:"timezone"`
	LastLoginAt  *time.Time `json:"last_login_at,omitempty"`
}

type OddsQuote struct {
	ID                string     `json:"id"`
	BookmakerID       string     `json:"bookmaker_id"`
	LobbyID           string     `json:"lobby_id"`
	FixtureID         string     `json:"fixture_id" gorm:"index:idx_odds_quotes_fixture_collected_at,priority:1;index:idx_odds_quotes_fixture_market_outcome,priority:1"`
	FixtureMarker     string     `json:"fixture_marker" gorm:"index:idx_odds_quotes_current_key,priority:1;index:idx_odds_quotes_state_start,priority:3"`
	HomeTeam          string     `json:"home_team"`
	AwayTeam          string     `json:"away_team"`
	LeagueName        string     `json:"league_name" gorm:"index"`
	Sport             string     `json:"sport"`
	MarketID          string     `json:"market_id" gorm:"index:idx_odds_quotes_fixture_market_outcome,priority:2"`
	MarketMarker      string     `json:"market_marker" gorm:"index:idx_odds_quotes_current_key,priority:2"`
	MarketName        string     `json:"market_name"`
	OutcomeID         string     `json:"outcome_id" gorm:"index:idx_odds_quotes_fixture_market_outcome,priority:3"`
	OutcomeMarker     string     `json:"outcome_marker" gorm:"index:idx_odds_quotes_current_key,priority:3"`
	OutcomeName       string     `json:"outcome_name"`
	Odds              float64    `json:"odds"`
	AvailableStake    float64    `json:"available_stake"`
	Suspended         bool       `json:"suspended"`
	MatchState        string     `json:"match_state" gorm:"index:idx_odds_quotes_state_start,priority:1"`
	EventStartAt      *time.Time `json:"event_start_at,omitempty" gorm:"index:idx_odds_quotes_state_start,priority:2"`
	CollectedAt       time.Time  `json:"collected_at" gorm:"index:idx_odds_quotes_fixture_collected_at,priority:2,sort:desc"`
	LastObservedAt    time.Time  `json:"last_observed_at"`
	ChangedAt         time.Time  `json:"changed_at"`
	ProtocolVersion   int        `json:"protocol_version,omitempty"`
	BatchID           string     `json:"batch_id,omitempty"`
	BatchFingerprint  string     `json:"batch_fingerprint,omitempty"`
	BatchSeq          int64      `json:"batch_seq,omitempty"`
	BatchSessionID    string     `json:"batch_session_id,omitempty"`
	SourceEventID     string     `json:"source_event_id,omitempty"`
	ProviderReference string     `json:"provider_reference,omitempty" gorm:"index:idx_odds_quotes_provider_reference"`
	MarketObservedAt  time.Time  `json:"market_observed_at,omitempty"`
	PriceChangedAt    time.Time  `json:"price_changed_at,omitempty"`
	CoherenceStatus   string     `json:"coherence_status,omitempty"`
	MarketPeriod      string     `json:"market_period,omitempty"`
	MarketLine        string     `json:"market_line,omitempty"`
	MarketSide        string     `json:"market_side,omitempty"`
	RawOdds           float64    `json:"raw_odds,omitempty"`
	OddsFormat        string     `json:"odds_format,omitempty"`
}

type SurebetLeg struct {
	BookmakerID       string    `json:"bookmaker_id"`
	LobbyID           string    `json:"lobby_id"`
	FixtureID         string    `json:"fixture_id"`
	MarketID          string    `json:"market_id"`
	OutcomeID         string    `json:"outcome_id"`
	OutcomeName       string    `json:"outcome_name"`
	ProviderReference string    `json:"provider_reference,omitempty"`
	Odds              float64   `json:"odds"`
	ObservedAt        time.Time `json:"observed_at,omitempty"`
}

type SurebetOpportunity struct {
	ID               string       `json:"id" gorm:"primaryKey"`
	FixtureID        string       `json:"fixture_id" gorm:"index"`
	Sport            string       `json:"sport"`
	MarketName       string       `json:"market_name"`
	ProfitPercentage float64      `json:"profit_percentage"`
	ExpectedReturn   float64      `json:"expected_return"`
	Currency         string       `json:"currency"`
	DetectedAt       time.Time    `json:"detected_at"`
	ExpiresAt        time.Time    `json:"expires_at"`
	MatchConfidence  float64      `json:"match_confidence"`
	MatchAmbiguous   bool         `json:"match_ambiguous"`
	Legs             []SurebetLeg `json:"legs" gorm:"-"`
}

type BetAction struct {
	BaseModel
	IdempotencyKey       string     `json:"idempotency_key" gorm:"uniqueIndex;not null"`
	OpportunityID        string     `json:"opportunity_id" gorm:"index;not null"`
	AccountID            string     `json:"account_id,omitempty" gorm:"index"`
	ConfirmationRevision string     `json:"confirmation_revision,omitempty" gorm:"index"`
	Mode                 string     `json:"mode" gorm:"not null"`
	Status               string     `json:"status" gorm:"index;not null"`
	Currency             string     `json:"currency" gorm:"not null"`
	TotalStakeVND        int64      `json:"total_stake_vnd" gorm:"not null"`
	ReservedStakeVND     int64      `json:"reserved_stake_vnd" gorm:"not null"`
	ReservationExpiresAt *time.Time `json:"reservation_expires_at,omitempty"`
	ExpectedReturn       float64    `json:"expected_return"`
	Legs                 []byte     `json:"legs" gorm:"type:jsonb;not null"`
	Events               []byte     `json:"events" gorm:"type:jsonb;not null"`
	ExposureOpen         bool       `json:"exposure_open" gorm:"not null"`
	ExposureID           string     `json:"exposure_id,omitempty" gorm:"index"`
	RepriceRevision      int        `json:"reprice_revision" gorm:"not null"`
	Version              int64      `json:"version" gorm:"not null;default:1"`
	LeaseOwner           string     `json:"lease_owner,omitempty"`
	LeaseExpiresAt       *time.Time `json:"lease_expires_at,omitempty" gorm:"index"`
	CompletedAt          *time.Time `json:"completed_at,omitempty"`
	ErrorCode            string     `json:"error_code,omitempty"`
	ErrorMessage         string     `json:"error_message,omitempty"`
}

// BetAttempt is the durable record of one collector command. Commit attempts
// must move through before_send -> submit_started -> response_received (or
// awaiting_reconcile) so a lost response can never be retried blindly.
type BetAttempt struct {
	BaseModel
	IdempotencyKey     string     `json:"idempotency_key" gorm:"uniqueIndex;not null"`
	ActionID           string     `json:"action_id" gorm:"index;not null"`
	ExposureID         string     `json:"exposure_id,omitempty" gorm:"index"`
	AccountID          string     `json:"account_id,omitempty" gorm:"index"`
	AttemptNumber      int        `json:"attempt_number" gorm:"not null"`
	Phase              string     `json:"phase" gorm:"index;not null"`
	Status             string     `json:"status" gorm:"index;not null"`
	Result             string     `json:"result,omitempty" gorm:"index"`
	RequestID          string     `json:"request_id,omitempty" gorm:"index"`
	SessionID          string     `json:"session_id,omitempty"`
	SessionGeneration  string     `json:"session_generation,omitempty"`
	LegID              string     `json:"leg_id" gorm:"index;not null"`
	BookmakerID        string     `json:"bookmaker_id" gorm:"index;not null"`
	LobbyID            string     `json:"lobby_id"`
	CollectorID        string     `json:"collector_id"`
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
	TicketID           string     `json:"ticket_id,omitempty" gorm:"index"`
	RawResponseHash    string     `json:"raw_response_hash,omitempty"`
	ExpiresAt          *time.Time `json:"expires_at,omitempty"`
	ObservedAt         *time.Time `json:"observed_at,omitempty"`
	SubmitStartedAt    *time.Time `json:"submit_started_at,omitempty"`
	ResponseReceivedAt *time.Time `json:"response_received_at,omitempty"`
	ReconciledAt       *time.Time `json:"reconciled_at,omitempty"`
	Version            int64      `json:"version" gorm:"not null;default:1"`
	ErrorCode          string     `json:"error_code,omitempty"`
	ErrorMessage       string     `json:"error_message,omitempty"`
}

// BetExposure exists only after a Jun88 ticket has been durably accepted. The
// Jun88 fields are immutable; subsequent updates only advance the 8xbet hedge.
type BetExposure struct {
	BaseModel
	IdempotencyKey string     `json:"idempotency_key" gorm:"uniqueIndex;not null"`
	ActionID       string     `json:"action_id" gorm:"uniqueIndex;not null"`
	AccountID      string     `json:"account_id" gorm:"index;not null"`
	Status         string     `json:"status" gorm:"index;not null"`
	Currency       string     `json:"currency" gorm:"not null"`
	Version        int64      `json:"version" gorm:"not null;default:1"`
	LeaseOwner     string     `json:"lease_owner,omitempty"`
	LeaseExpiresAt *time.Time `json:"lease_expires_at,omitempty" gorm:"index"`

	Jun88AttemptID         string    `json:"jun88_attempt_id" gorm:"not null"`
	Jun88TicketID          string    `json:"jun88_ticket_id" gorm:"index;not null"`
	Jun88LegID             string    `json:"jun88_leg_id" gorm:"not null"`
	Jun88FixtureID         string    `json:"jun88_fixture_id" gorm:"not null"`
	Jun88MarketID          string    `json:"jun88_market_id" gorm:"not null"`
	Jun88OutcomeID         string    `json:"jun88_outcome_id" gorm:"not null"`
	Jun88ProviderReference string    `json:"jun88_provider_reference" gorm:"not null"`
	Jun88AcceptedOdds      float64   `json:"jun88_accepted_odds" gorm:"not null"`
	Jun88StakeVND          int64     `json:"jun88_stake_vnd" gorm:"not null"`
	Jun88AcceptedAt        time.Time `json:"jun88_accepted_at" gorm:"not null"`

	HedgeBookmakerID        string     `json:"hedge_bookmaker_id" gorm:"not null"`
	HedgeLegID              string     `json:"hedge_leg_id" gorm:"not null"`
	HedgeFixtureID          string     `json:"hedge_fixture_id" gorm:"index;not null"`
	HedgeMarketID           string     `json:"hedge_market_id" gorm:"index;not null"`
	HedgeOutcomeID          string     `json:"hedge_outcome_id" gorm:"index;not null"`
	HedgeProviderReference  string     `json:"hedge_provider_reference" gorm:"not null"`
	MaximumTotalStakeVND    int64      `json:"maximum_total_stake_vnd" gorm:"not null"`
	HedgeMinimumStakeVND    int64      `json:"hedge_minimum_stake_vnd,omitempty"`
	HedgeMaximumStakeVND    int64      `json:"hedge_maximum_stake_vnd,omitempty"`
	HedgeStakeIncrementVND  int64      `json:"hedge_stake_increment_vnd" gorm:"not null"`
	CurrentHedgeOdds        float64    `json:"current_hedge_odds,omitempty"`
	RequiredHedgeStakeVND   int64      `json:"required_hedge_stake_vnd,omitempty"`
	ProjectedJunProfitVND   int64      `json:"projected_jun_profit_vnd,omitempty"`
	ProjectedHedgeProfitVND int64      `json:"projected_hedge_profit_vnd,omitempty"`
	LastQuoteRevision       string     `json:"last_quote_revision,omitempty"`
	LastQuoteObservedAt     *time.Time `json:"last_quote_observed_at,omitempty"`
	NextEvaluationAt        *time.Time `json:"next_evaluation_at,omitempty" gorm:"index"`

	HedgeAttemptID        string     `json:"hedge_attempt_id,omitempty"`
	HedgeTicketID         string     `json:"hedge_ticket_id,omitempty" gorm:"index"`
	HedgeAcceptedOdds     float64    `json:"hedge_accepted_odds,omitempty"`
	HedgeAcceptedStakeVND int64      `json:"hedge_accepted_stake_vnd,omitempty"`
	HedgeAcceptedAt       *time.Time `json:"hedge_accepted_at,omitempty"`
	OpenedAt              time.Time  `json:"opened_at" gorm:"not null"`
	CompletedAt           *time.Time `json:"completed_at,omitempty"`
	ClosedAt              *time.Time `json:"closed_at,omitempty"`
	MarketClosedAt        *time.Time `json:"market_closed_at,omitempty"`
	LastFailureCode       string     `json:"last_failure_code,omitempty"`
	LastFailureMessage    string     `json:"last_failure_message,omitempty"`
}

type BetActionEvent struct {
	BaseModel
	IdempotencyKey string    `json:"idempotency_key" gorm:"uniqueIndex;not null"`
	ActionID       string    `json:"action_id" gorm:"uniqueIndex:idx_bet_action_events_action_sequence,priority:1;not null"`
	ExposureID     string    `json:"exposure_id,omitempty" gorm:"index"`
	Sequence       int64     `json:"sequence" gorm:"uniqueIndex:idx_bet_action_events_action_sequence,priority:2;not null"`
	Type           string    `json:"type" gorm:"index;not null"`
	Status         string    `json:"status" gorm:"index;not null"`
	BookmakerID    string    `json:"bookmaker_id,omitempty"`
	Message        string    `json:"message,omitempty"`
	Metadata       []byte    `json:"metadata" gorm:"type:jsonb;not null"`
	OccurredAt     time.Time `json:"occurred_at" gorm:"index;not null"`
}
