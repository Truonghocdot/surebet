package dto

import "time"

const CollectorStreamProtocolVersion = 1

type CollectorStreamFrame struct {
	Type string `json:"type"`
}

type CollectorStreamHello struct {
	Type            string          `json:"type"`
	ProtocolVersion int             `json:"protocol_version"`
	SessionID       string          `json:"session_id"`
	Source          CollectorSource `json:"source"`
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
	FixtureID string `json:"fixture_id"`
	MarketID  string `json:"market_id"`
	OutcomeID string `json:"outcome_id"`
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

type CollectorStreamHelloAck struct {
	Type            string          `json:"type"`
	ProtocolVersion int             `json:"protocol_version"`
	SessionID       string          `json:"session_id"`
	Source          CollectorSource `json:"source"`
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
