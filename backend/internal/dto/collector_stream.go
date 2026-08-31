package dto

import "time"

const (
	CollectorStreamProtocolVersion    = 4
	CollectorStreamMinProtocolVersion = 1
)

type CollectorStreamFrame struct {
	Type string `json:"type"`
}

type CollectorStreamHello struct {
	Type            string          `json:"type"`
	ProtocolVersion int             `json:"protocol_version"`
	SessionID       string          `json:"session_id"`
	Source          CollectorSource `json:"source"`
	AccountID       string          `json:"account_id,omitempty"`
	Capabilities    []string        `json:"capabilities,omitempty"`
	StartedAt       time.Time       `json:"started_at"`
}

type CollectorStreamSnapshotBegin struct {
	Type       string    `json:"type"`
	SessionID  string    `json:"session_id"`
	SnapshotID string    `json:"snapshot_id"`
	Seq        int64     `json:"seq"`
	SentAt     time.Time `json:"sent_at"`
}

type CollectorStreamRawIDs struct {
	FixtureID   string `json:"fixture_id"`
	MarketID    string `json:"market_id"`
	OutcomeID   string `json:"outcome_id"`
	ProviderRef string `json:"provider_ref,omitempty"`
}

type CollectorStreamMarkers struct {
	FixtureMarker string `json:"fixture_marker"`
	MarketMarker  string `json:"market_marker"`
	OutcomeMarker string `json:"outcome_marker"`
}

type CollectorStreamQuote struct {
	Sport          string  `json:"sport"`
	HomeTeam       string  `json:"home_team"`
	AwayTeam       string  `json:"away_team"`
	LeagueName     string  `json:"league_name"`
	MatchState     string  `json:"match_state"`
	EventStartAt   string  `json:"event_start_at"`
	OutcomeName    string  `json:"outcome_name"`
	Odds           float64 `json:"odds"`
	AvailableStake float64 `json:"available_stake"`
	Suspended      bool    `json:"suspended"`
	ProviderRef    string  `json:"provider_ref,omitempty"`
}

type CollectorStreamFixture struct {
	FixtureID    string `json:"fixture_id"`
	Sport        string `json:"sport"`
	HomeTeam     string `json:"home_team"`
	AwayTeam     string `json:"away_team"`
	LeagueName   string `json:"league_name"`
	MatchState   string `json:"match_state"`
	EventStartAt string `json:"event_start_at"`
}

type CollectorStreamMarketOutcome struct {
	OutcomeID      string  `json:"outcome_id"`
	OutcomeName    string  `json:"outcome_name"`
	Side           string  `json:"side"`
	Odds           float64 `json:"odds"`
	RawOdds        float64 `json:"raw_odds,omitempty"`
	OddsFormat     string  `json:"odds_format,omitempty"`
	ProviderRef    string  `json:"provider_ref,omitempty"`
	AvailableStake float64 `json:"available_stake"`
	Suspended      bool    `json:"suspended"`
}

type CollectorStreamFixtureMarket struct {
	MarketID       string                         `json:"market_id"`
	Period         string                         `json:"period"`
	NormalizedLine string                         `json:"normalized_line"`
	Status         string                         `json:"status"`
	Outcomes       []CollectorStreamMarketOutcome `json:"outcomes"`
}

type CollectorStreamFixtureMarketSnapshot struct {
	Type            string                         `json:"type"`
	ProtocolVersion int                            `json:"protocol_version"`
	SessionID       string                         `json:"session_id"`
	Seq             int64                          `json:"seq"`
	BatchID         string                         `json:"batch_id"`
	Fingerprint     string                         `json:"fingerprint"`
	SourceEventID   string                         `json:"source_event_id,omitempty"`
	ObservedAt      time.Time                      `json:"observed_at"`
	Source          CollectorSource                `json:"source"`
	Fixture         CollectorStreamFixture         `json:"fixture"`
	Complete        bool                           `json:"complete"`
	Markets         []CollectorStreamFixtureMarket `json:"markets"`
}

type CollectorStreamFixtureObservation struct {
	FixtureID   string `json:"fixture_id"`
	BatchID     string `json:"batch_id"`
	Fingerprint string `json:"fingerprint"`
}

type CollectorStreamFixtureObservedBatch struct {
	Type            string                              `json:"type"`
	ProtocolVersion int                                 `json:"protocol_version"`
	SessionID       string                              `json:"session_id"`
	Seq             int64                               `json:"seq"`
	ObservedAt      time.Time                           `json:"observed_at"`
	Source          CollectorSource                     `json:"source"`
	Items           []CollectorStreamFixtureObservation `json:"items"`
}

type CollectorStreamQuoteUpsert struct {
	Type       string                 `json:"type"`
	SessionID  string                 `json:"session_id"`
	SnapshotID string                 `json:"snapshot_id,omitempty"`
	Seq        int64                  `json:"seq"`
	OccurredAt time.Time              `json:"occurred_at"`
	Source     CollectorSource        `json:"source"`
	RawIDs     CollectorStreamRawIDs  `json:"raw_ids"`
	Markers    CollectorStreamMarkers `json:"markers"`
	Quote      CollectorStreamQuote   `json:"quote"`
}

type CollectorStreamQuoteUpsertBatch struct {
	Type       string                           `json:"type"`
	SessionID  string                           `json:"session_id"`
	SnapshotID string                           `json:"snapshot_id,omitempty"`
	Seq        int64                            `json:"seq"`
	Source     CollectorSource                  `json:"source"`
	Items      []CollectorStreamQuoteUpsertItem `json:"items"`
}

type CollectorStreamQuoteUpsertItem struct {
	OccurredAt time.Time              `json:"occurred_at"`
	RawIDs     CollectorStreamRawIDs  `json:"raw_ids"`
	Markers    CollectorStreamMarkers `json:"markers"`
	Quote      CollectorStreamQuote   `json:"quote"`
}

type CollectorStreamQuoteRemove struct {
	Type       string                 `json:"type"`
	SessionID  string                 `json:"session_id"`
	SnapshotID string                 `json:"snapshot_id,omitempty"`
	Seq        int64                  `json:"seq"`
	OccurredAt time.Time              `json:"occurred_at"`
	Source     CollectorSource        `json:"source"`
	RawIDs     CollectorStreamRawIDs  `json:"raw_ids"`
	Markers    CollectorStreamMarkers `json:"markers"`
}

type CollectorStreamSnapshotCommit struct {
	Type          string    `json:"type"`
	SessionID     string    `json:"session_id"`
	SnapshotID    string    `json:"snapshot_id"`
	Seq           int64     `json:"seq"`
	SentAt        time.Time `json:"sent_at"`
	ExpectedCount int       `json:"expected_count"`
}

type CollectorStreamHeartbeat struct {
	Type      string    `json:"type"`
	SessionID string    `json:"session_id"`
	Seq       int64     `json:"seq"`
	SentAt    time.Time `json:"sent_at"`
}

type CollectorAccountBalanceValue struct {
	Amount      float64  `json:"amount"`
	Currency    string   `json:"currency"`
	AmountVND   *float64 `json:"amount_vnd,omitempty"`
	DisplayText string   `json:"display_text,omitempty"`
}

type CollectorStreamAccountBalance struct {
	Type            string                       `json:"type"`
	ProtocolVersion int                          `json:"protocol_version"`
	SessionID       string                       `json:"session_id"`
	Seq             int64                        `json:"seq"`
	ObservedAt      time.Time                    `json:"observed_at"`
	Source          CollectorSource              `json:"source"`
	AccountID       string                       `json:"account_id"`
	Balance         CollectorAccountBalanceValue `json:"balance"`
}

type CollectorAccountBalanceView struct {
	AccountID  string                       `json:"account_id"`
	Source     CollectorSource              `json:"source"`
	Balance    CollectorAccountBalanceValue `json:"balance"`
	ObservedAt time.Time                    `json:"observed_at"`
	ReceivedAt time.Time                    `json:"received_at"`
	Stale      bool                         `json:"stale"`
}

type CollectorAccountBalanceListView struct {
	Items             []CollectorAccountBalanceView `json:"items"`
	ServerTime        time.Time                     `json:"server_time"`
	StaleAfterSeconds int64                         `json:"stale_after_seconds"`
}

type CollectorConfirmQuoteRequest struct {
	Type        string    `json:"type"`
	SessionID   string    `json:"session_id"`
	RequestID   string    `json:"request_id"`
	RequestedAt time.Time `json:"requested_at"`
	FixtureID   string    `json:"fixture_id"`
	MarketID    string    `json:"market_id"`
	OutcomeID   string    `json:"outcome_id"`
	TimeoutMS   int       `json:"timeout_ms"`
}

type CollectorConfirmedSelection struct {
	FixtureID      string  `json:"fixture_id"`
	Sport          string  `json:"sport"`
	HomeTeam       string  `json:"home_team"`
	AwayTeam       string  `json:"away_team"`
	LeagueName     string  `json:"league_name"`
	MatchState     string  `json:"match_state"`
	EventStartAt   string  `json:"event_start_at"`
	MarketID       string  `json:"market_id"`
	OutcomeID      string  `json:"outcome_id"`
	OutcomeName    string  `json:"outcome_name"`
	Odds           float64 `json:"odds"`
	AvailableStake float64 `json:"available_stake"`
	Suspended      bool    `json:"suspended"`
	SourceEventID  string  `json:"source_event_id,omitempty"`
	RawOdds        float64 `json:"raw_odds,omitempty"`
	OddsFormat     string  `json:"odds_format,omitempty"`
	ProviderRef    string  `json:"provider_ref,omitempty"`
}

type CollectorConfirmQuoteResponse struct {
	Type       string                       `json:"type"`
	SessionID  string                       `json:"session_id"`
	Seq        int64                        `json:"seq"`
	RequestID  string                       `json:"request_id"`
	ObservedAt time.Time                    `json:"observed_at"`
	Found      bool                         `json:"found"`
	Error      string                       `json:"error,omitempty"`
	Selection  *CollectorConfirmedSelection `json:"selection,omitempty"`
}

type CollectorSimulatedBetRequest struct {
	Type           string    `json:"type"`
	SessionID      string    `json:"session_id"`
	RequestID      string    `json:"request_id"`
	ActionID       string    `json:"action_id"`
	OpportunityID  string    `json:"opportunity_id"`
	LegID          string    `json:"leg_id"`
	Sequence       int       `json:"sequence"`
	RequestedAt    time.Time `json:"requested_at"`
	FixtureID      string    `json:"fixture_id"`
	MarketID       string    `json:"market_id"`
	OutcomeID      string    `json:"outcome_id"`
	ExpectedOdds   float64   `json:"expected_odds"`
	StakeVND       int64     `json:"stake_vnd"`
	ExpiresAt      time.Time `json:"expires_at"`
	TimeoutMS      int       `json:"timeout_ms"`
	IdempotencyKey string    `json:"idempotency_key,omitempty"`
}

type CollectorSimulatedBetResponse struct {
	Type                 string                       `json:"type"`
	SessionID            string                       `json:"session_id"`
	Seq                  int64                        `json:"seq"`
	RequestID            string                       `json:"request_id"`
	ActionID             string                       `json:"action_id"`
	OpportunityID        string                       `json:"opportunity_id"`
	LegID                string                       `json:"leg_id"`
	Sequence             int                          `json:"sequence"`
	IdempotencyKey       string                       `json:"idempotency_key,omitempty"`
	Result               string                       `json:"result"`
	ObservedAt           time.Time                    `json:"observed_at"`
	ExpectedOdds         float64                      `json:"expected_odds,omitempty"`
	SelectedOdds         float64                      `json:"selected_odds,omitempty"`
	Selection            *CollectorConfirmedSelection `json:"selection,omitempty"`
	TicketID             string                       `json:"ticket_id,omitempty"`
	AcceptedOdds         float64                      `json:"accepted_odds,omitempty"`
	StakeVND             int64                        `json:"stake_vnd,omitempty"`
	SubmittedOdds        float64                      `json:"submitted_odds,omitempty"`
	OfferedOdds          float64                      `json:"offered_odds,omitempty"`
	ConfirmationRequired bool                         `json:"confirmation_required,omitempty"`
	Error                string                       `json:"error,omitempty"`
}

type CollectorLiveBetRequest struct {
	Type            string          `json:"type"`
	ProtocolVersion int             `json:"protocol_version"`
	SessionID       string          `json:"session_id"`
	RequestID       string          `json:"request_id"`
	ActionID        string          `json:"action_id"`
	AttemptID       string          `json:"attempt_id"`
	OpportunityID   string          `json:"opportunity_id"`
	LegID           string          `json:"leg_id"`
	AccountID       string          `json:"account_id"`
	Source          CollectorSource `json:"source"`
	RequestedAt     time.Time       `json:"requested_at"`
	ExpiresAt       time.Time       `json:"expires_at"`
	TimeoutMS       int             `json:"timeout_ms,omitempty"`

	FixtureID       string  `json:"fixture_id,omitempty"`
	MarketID        string  `json:"market_id,omitempty"`
	OutcomeID       string  `json:"outcome_id,omitempty"`
	ProviderRef     string  `json:"provider_ref,omitempty"`
	ExpectedOdds    float64 `json:"expected_odds,omitempty"`
	ExpectedRawOdds float64 `json:"expected_raw_odds,omitempty"`
	OddsFormat      string  `json:"odds_format,omitempty"`
	QuoteRevision   string  `json:"quote_revision,omitempty"`

	PrepareID      string `json:"prepare_id,omitempty"`
	IdempotencyKey string `json:"idempotency_key,omitempty"`
	StakeVND       int64  `json:"stake_vnd,omitempty"`
}

type CollectorLiveBetResponse struct {
	Type            string          `json:"type"`
	ProtocolVersion int             `json:"protocol_version"`
	SessionID       string          `json:"session_id"`
	Seq             int64           `json:"seq"`
	RequestID       string          `json:"request_id"`
	ActionID        string          `json:"action_id"`
	AttemptID       string          `json:"attempt_id"`
	OpportunityID   string          `json:"opportunity_id"`
	LegID           string          `json:"leg_id"`
	AccountID       string          `json:"account_id"`
	Source          CollectorSource `json:"source"`
	Result          string          `json:"result"`
	ObservedAt      time.Time       `json:"observed_at"`
	Error           string          `json:"error,omitempty"`

	PrepareID         string  `json:"prepare_id,omitempty"`
	SlipFingerprint   string  `json:"slip_fingerprint,omitempty"`
	DisplayedOdds     float64 `json:"displayed_odds,omitempty"`
	RawOdds           float64 `json:"raw_odds,omitempty"`
	OddsFormat        string  `json:"odds_format,omitempty"`
	MinimumStakeVND   int64   `json:"minimum_stake_vnd,omitempty"`
	MaximumStakeVND   int64   `json:"maximum_stake_vnd,omitempty"`
	StakeIncrementVND int64   `json:"stake_increment_vnd,omitempty"`
	BalanceVND        int64   `json:"balance_vnd,omitempty"`
	SessionGeneration string  `json:"session_generation,omitempty"`

	IdempotencyKey       string  `json:"idempotency_key,omitempty"`
	TicketID             string  `json:"ticket_id,omitempty"`
	AcceptedOdds         float64 `json:"accepted_odds,omitempty"`
	StakeVND             int64   `json:"stake_vnd,omitempty"`
	SubmittedOdds        float64 `json:"submitted_odds,omitempty"`
	OfferedOdds          float64 `json:"offered_odds,omitempty"`
	ConfirmationRequired bool    `json:"confirmation_required,omitempty"`
}

type CollectorStreamHelloAck struct {
	Type            string          `json:"type"`
	ProtocolVersion int             `json:"protocol_version"`
	SessionID       string          `json:"session_id"`
	Source          CollectorSource `json:"source"`
	AccountID       string          `json:"account_id,omitempty"`
	Capabilities    []string        `json:"capabilities,omitempty"`
	ServerTime      time.Time       `json:"server_time"`
}

type CollectorStreamResyncRequired struct {
	Type      string `json:"type"`
	SessionID string `json:"session_id"`
	Reason    string `json:"reason"`
}

type CollectorStreamError struct {
	Type      string `json:"type"`
	SessionID string `json:"session_id,omitempty"`
	Code      string `json:"code"`
	Message   string `json:"message"`
}
