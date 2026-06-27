package dto

import "time"

type OddsFilter struct {
	BookmakerID string
	LobbyID     string
	FixtureID   string
}

type OddsView struct {
	BookmakerID    string    `json:"bookmaker_id"`
	LobbyID        string    `json:"lobby_id"`
	FixtureID      string    `json:"fixture_id"`
	MarketID       string    `json:"market_id"`
	OutcomeID      string    `json:"outcome_id"`
	Odds           float64   `json:"odds"`
	AvailableStake float64   `json:"available_stake"`
	CollectedAt    time.Time `json:"collected_at"`
}

type SurebetLegView struct {
	BookmakerID string  `json:"bookmaker_id"`
	MarketID    string  `json:"market_id"`
	OutcomeID   string  `json:"outcome_id"`
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
