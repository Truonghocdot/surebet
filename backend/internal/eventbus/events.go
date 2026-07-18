package eventbus

import "time"

type EventType string

const EventOddsUpdated EventType = "OddsUpdated"

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
	BookmakerID    string    `json:"bookmaker_id"`
	LobbyID        string    `json:"lobby_id"`
	FixtureID      string    `json:"fixture_id"`
	HomeTeam       string    `json:"home_team"`
	AwayTeam       string    `json:"away_team"`
	MarketID       string    `json:"market_id"`
	OutcomeID      string    `json:"outcome_id"`
	Odds           float64   `json:"odds"`
	AvailableStake float64   `json:"available_stake"`
	Suspended      bool      `json:"suspended"`
	CollectedAt    time.Time `json:"collected_at"`
}

type OddsUpdatedPayload struct {
	CollectorID string             `json:"collector_id"`
	BookmakerID string             `json:"bookmaker_id"`
	LobbyID     string             `json:"lobby_id"`
	Quotes      []OddsQuotePayload `json:"quotes"`
}

type OddsUpdatedEvent = Envelope[OddsUpdatedPayload]
