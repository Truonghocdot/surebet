package dto

import "time"

type CollectorSource struct {
	CollectorID string `json:"collector_id" binding:"required"`
	BookmakerID string `json:"bookmaker_id" binding:"required"`
	LobbyID     string `json:"lobby_id" binding:"required"`
}

type CollectorSelection struct {
	FixtureID      string  `json:"fixture_id" binding:"required"`
	HomeTeam       string  `json:"home_team"`
	AwayTeam       string  `json:"away_team"`
	LeagueName     string  `json:"league_name"`
	MatchState     string  `json:"match_state"`
	EventStartAt   string  `json:"event_start_at"`
	MarketID       string  `json:"market_id" binding:"required"`
	OutcomeID      string  `json:"outcome_id" binding:"required"`
	OutcomeName    string  `json:"outcome_name" binding:"required"`
	Odds           float64 `json:"odds"`
	AvailableStake float64 `json:"available_stake"`
	Suspended      bool    `json:"suspended"`
}

type CollectorBootstrapRequest struct {
	Source      CollectorSource      `json:"source" binding:"required"`
	CollectedAt time.Time            `json:"collected_at" binding:"required"`
	Selections  []CollectorSelection `json:"selections" binding:"required"`
}

type CollectorDelta struct {
	Source         CollectorSource `json:"source" binding:"required"`
	CollectedAt    time.Time       `json:"collected_at" binding:"required"`
	FixtureID      string          `json:"fixture_id" binding:"required"`
	HomeTeam       string          `json:"home_team"`
	AwayTeam       string          `json:"away_team"`
	LeagueName     string          `json:"league_name"`
	MatchState     string          `json:"match_state"`
	EventStartAt   string          `json:"event_start_at"`
	MarketID       string          `json:"market_id" binding:"required"`
	OutcomeID      string          `json:"outcome_id" binding:"required"`
	OutcomeName    string          `json:"outcome_name" binding:"required"`
	Odds           float64         `json:"odds"`
	AvailableStake float64         `json:"available_stake"`
	Suspended      bool            `json:"suspended"`
	Op             string          `json:"op" binding:"required"`
}

type CollectorDeltaRequest struct {
	Deltas []CollectorDelta `json:"deltas" binding:"required"`
}

type CollectorHeartbeatRequest struct {
	CollectorID string    `json:"collector_id" binding:"required"`
	BookmakerID string    `json:"bookmaker_id" binding:"required"`
	LobbyID     string    `json:"lobby_id" binding:"required"`
	SentAt      time.Time `json:"sent_at" binding:"required"`
}
