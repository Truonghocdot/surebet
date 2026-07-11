package dto

import "time"

type OddsFilter struct {
	BookmakerID      string
	LobbyID          string
	FixtureID        string
	IncludeSuspended bool
}

type OddsView struct {
	BookmakerID    string     `json:"bookmaker_id"`
	LobbyID        string     `json:"lobby_id"`
	FixtureID      string     `json:"fixture_id"`
	FixtureMarker  string     `json:"fixture_marker"`
	LeagueName     string     `json:"league_name"`
	HomeTeam       string     `json:"home_team"`
	AwayTeam       string     `json:"away_team"`
	MatchState     string     `json:"match_state"`
	EventStartAt   *time.Time `json:"event_start_at,omitempty"`
	MatchName      string     `json:"match_name"`
	Period         string     `json:"period"`
	MarketType     string     `json:"market_type"`
	Line           string     `json:"line"`
	Side           string     `json:"side"`
	MarketID       string     `json:"market_id"`
	OutcomeID      string     `json:"outcome_id"`
	OutcomeName    string     `json:"outcome_name"`
	Odds           float64    `json:"odds"`
	DecimalOdds    float64    `json:"decimal_odds"`
	AvailableStake float64    `json:"available_stake"`
	Suspended      bool       `json:"suspended"`
	CollectedAt    time.Time  `json:"collected_at"`
}

type SurebetLegView struct {
	BookmakerID string  `json:"bookmaker_id"`
	LobbyID     string  `json:"lobby_id"`
	MarketID    string  `json:"market_id"`
	OutcomeID   string  `json:"outcome_id"`
	OutcomeName string  `json:"outcome_name"`
	Odds        float64 `json:"odds"`
	Stake       float64 `json:"stake"`
}

type SurebetView struct {
	ID               string           `json:"id"`
	FixtureID        string           `json:"fixture_id"`
	MarketName       string           `json:"market_name"`
	ProfitPercentage float64          `json:"profit_percentage"`
	ExpectedReturn   float64          `json:"expected_return"`
	DetectedAt       time.Time        `json:"detected_at"`
	ExpiresAt        time.Time        `json:"expires_at"`
	Legs             []SurebetLegView `json:"legs"`
}
