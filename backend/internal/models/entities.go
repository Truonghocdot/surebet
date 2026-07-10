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
	PasswordHash string     `json:"-" gorm:"not null"`
	FullName     string     `json:"full_name"`
	Role         string     `json:"role"`
	IsActive     bool       `json:"is_active"`
	Locale       string     `json:"locale"`
	Timezone     string     `json:"timezone"`
	LastLoginAt  *time.Time `json:"last_login_at,omitempty"`
}

type OddsQuote struct {
	ID             string    `json:"id"`
	BookmakerID    string    `json:"bookmaker_id"`
	LobbyID        string    `json:"lobby_id"`
	FixtureID      string    `json:"fixture_id" gorm:"index:idx_odds_quotes_fixture_collected_at,priority:1;index:idx_odds_quotes_fixture_market_outcome,priority:1"`
	HomeTeam       string    `json:"home_team"`
	AwayTeam       string    `json:"away_team"`
	Sport          string    `json:"sport"`
	MarketID       string    `json:"market_id" gorm:"index:idx_odds_quotes_fixture_market_outcome,priority:2"`
	MarketName     string    `json:"market_name"`
	OutcomeID      string    `json:"outcome_id" gorm:"index:idx_odds_quotes_fixture_market_outcome,priority:3"`
	OutcomeName    string    `json:"outcome_name"`
	Odds           float64   `json:"odds"`
	AvailableStake float64   `json:"available_stake"`
	Suspended      bool      `json:"suspended"`
	CollectedAt    time.Time `json:"collected_at" gorm:"index:idx_odds_quotes_fixture_collected_at,priority:2,sort:desc"`
}

type SurebetLeg struct {
	BookmakerID string  `json:"bookmaker_id"`
	LobbyID     string  `json:"lobby_id"`
	MarketID    string  `json:"market_id"`
	OutcomeID   string  `json:"outcome_id"`
	OutcomeName string  `json:"outcome_name"`
	Odds        float64 `json:"odds"`
	Stake       float64 `json:"stake"`
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
	Legs             []SurebetLeg `json:"legs" gorm:"-"`
}
