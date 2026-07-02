package eventbus

import "time"

type EventType string

const (
	EventOddsUpdated      EventType = "OddsUpdated"
	EventSurebetDetected  EventType = "SurebetDetected"
	EventValidationPassed EventType = "ValidationPassed"
	EventValidationFailed EventType = "ValidationFailed"
	EventBetRequested     EventType = "BetRequested"
	EventBetStarted       EventType = "BetStarted"
	EventBetAccepted      EventType = "BetAccepted"
	EventBetRejected      EventType = "BetRejected"
	EventBetSettled       EventType = "BetSettled"
	EventAlertCreated     EventType = "AlertCreated"
)

type Metadata struct {
	EventID       string    `json:"event_id"`
	TraceID       string    `json:"trace_id"`
	CorrelationID string    `json:"correlation_id"`
	Producer      string    `json:"producer"`
	Version       int       `json:"version"`
	OccurredAt    time.Time `json:"occurred_at"`
}

type Envelope[T any] struct {
	Type     EventType `json:"type"`
	Metadata Metadata  `json:"metadata"`
	Payload  T         `json:"payload"`
}

type SurebetLegPayload struct {
	BookmakerID string  `json:"bookmaker_id"`
	LobbyID     string  `json:"lobby_id"`
	MarketID    string  `json:"market_id"`
	OutcomeID   string  `json:"outcome_id"`
	Odds        float64 `json:"odds"`
	Stake       float64 `json:"stake"`
}

type OddsQuotePayload struct {
	BookmakerID    string    `json:"bookmaker_id"`
	LobbyID        string    `json:"lobby_id"`
	FixtureID      string    `json:"fixture_id"`
	HomeTeam       string    `json:"home_team"`
	AwayTeam       string    `json:"away_team"`
	MarketID       string    `json:"market_id"`
	OutcomeID      string    `json:"outcome_id"`
	Odds           float64   `json:"odds"`
	AvailableStake float64   `json:"available_stake"`
	CollectedAt    time.Time `json:"collected_at"`
}

type OddsUpdatedPayload struct {
	CollectorID string             `json:"collector_id"`
	BookmakerID string             `json:"bookmaker_id"`
	LobbyID     string             `json:"lobby_id"`
	Quotes      []OddsQuotePayload `json:"quotes"`
}

type SurebetDetectedPayload struct {
	OpportunityID    string              `json:"opportunity_id"`
	FixtureID        string              `json:"fixture_id"`
	ProfitPercentage float64             `json:"profit_percentage"`
	ExpectedReturn   float64             `json:"expected_return"`
	DetectedAt       time.Time           `json:"detected_at"`
	ExpiresAt        time.Time           `json:"expires_at"`
	Legs             []SurebetLegPayload `json:"legs"`
}

type ValidationPassedPayload struct {
	OpportunityID string    `json:"opportunity_id"`
	OrderID       string    `json:"order_id"`
	Step          string    `json:"step"`
	EvaluatedAt   time.Time `json:"evaluated_at"`
}

type ValidationFailedPayload struct {
	OpportunityID string    `json:"opportunity_id"`
	OrderID       string    `json:"order_id"`
	Step          string    `json:"step"`
	Reason        string    `json:"reason"`
	EvaluatedAt   time.Time `json:"evaluated_at"`
}

type BetRequestedPayload struct {
	OrderID          string    `json:"order_id"`
	OpportunityID    string    `json:"opportunity_id"`
	RequestedBy      string    `json:"requested_by"`
	RequiresApproval bool      `json:"requires_approval"`
	RequestedAt      time.Time `json:"requested_at"`
}

type BetStartedPayload struct {
	OrderID   string    `json:"order_id"`
	WorkerID  string    `json:"worker_id"`
	StartedAt time.Time `json:"started_at"`
}

type BetAcceptedPayload struct {
	OrderID           string    `json:"order_id"`
	BookmakerID       string    `json:"bookmaker_id"`
	ExternalReference string    `json:"external_reference"`
	AcceptedOdds      float64   `json:"accepted_odds"`
	AcceptedStake     float64   `json:"accepted_stake"`
	AcceptedAt        time.Time `json:"accepted_at"`
}

type BetRejectedPayload struct {
	OrderID     string    `json:"order_id"`
	BookmakerID string    `json:"bookmaker_id"`
	Reason      string    `json:"reason"`
	RejectedAt  time.Time `json:"rejected_at"`
}

type BetSettledPayload struct {
	OrderID   string    `json:"order_id"`
	Profit    float64   `json:"profit"`
	SettledAt time.Time `json:"settled_at"`
}

type AlertCreatedPayload struct {
	AlertID     string    `json:"alert_id"`
	Severity    string    `json:"severity"`
	Title       string    `json:"title"`
	Description string    `json:"description"`
	CreatedAt   time.Time `json:"created_at"`
}

type OddsUpdatedEvent = Envelope[OddsUpdatedPayload]
type SurebetDetectedEvent = Envelope[SurebetDetectedPayload]
type ValidationPassedEvent = Envelope[ValidationPassedPayload]
type ValidationFailedEvent = Envelope[ValidationFailedPayload]
type BetRequestedEvent = Envelope[BetRequestedPayload]
type BetStartedEvent = Envelope[BetStartedPayload]
type BetAcceptedEvent = Envelope[BetAcceptedPayload]
type BetRejectedEvent = Envelope[BetRejectedPayload]
type BetSettledEvent = Envelope[BetSettledPayload]
type AlertCreatedEvent = Envelope[AlertCreatedPayload]
