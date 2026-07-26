package eventbus

import "time"

type EventType string

const (
	EventOddsUpdated         EventType = "OddsUpdated"
	EventFixtureOddsSnapshot EventType = "FixtureOddsSnapshot"
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

type OddsQuotePayload struct {
	BookmakerID      string    `json:"bookmaker_id"`
	LobbyID          string    `json:"lobby_id"`
	FixtureID        string    `json:"fixture_id"`
	HomeTeam         string    `json:"home_team"`
	AwayTeam         string    `json:"away_team"`
	MarketID         string    `json:"market_id"`
	OutcomeID        string    `json:"outcome_id"`
	OutcomeName      string    `json:"outcome_name"`
	Odds             float64   `json:"odds"`
	AvailableStake   float64   `json:"available_stake"`
	Suspended        bool      `json:"suspended"`
	CollectedAt      time.Time `json:"collected_at"`
	ProtocolVersion  int       `json:"protocol_version,omitempty"`
	BatchID          string    `json:"batch_id,omitempty"`
	SourceEventID    string    `json:"source_event_id,omitempty"`
	MarketObservedAt time.Time `json:"market_observed_at,omitempty"`
	PriceChangedAt   time.Time `json:"price_changed_at,omitempty"`
	CoherenceStatus  string    `json:"coherence_status,omitempty"`
	Period           string    `json:"period,omitempty"`
	Line             string    `json:"line,omitempty"`
	Side             string    `json:"side,omitempty"`
	RawOdds          float64   `json:"raw_odds,omitempty"`
	OddsFormat       string    `json:"odds_format,omitempty"`
}

type OddsUpdatedPayload struct {
	CollectorID string             `json:"collector_id"`
	BookmakerID string             `json:"bookmaker_id"`
	LobbyID     string             `json:"lobby_id"`
	Quotes      []OddsQuotePayload `json:"quotes"`
}

type OddsUpdatedEvent = Envelope[OddsUpdatedPayload]
