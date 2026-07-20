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
	ID             string     `json:"id"`
	BookmakerID    string     `json:"bookmaker_id"`
	LobbyID        string     `json:"lobby_id"`
	FixtureID      string     `json:"fixture_id" gorm:"index:idx_odds_quotes_fixture_collected_at,priority:1;index:idx_odds_quotes_fixture_market_outcome,priority:1"`
	FixtureMarker  string     `json:"fixture_marker" gorm:"index:idx_odds_quotes_current_key,priority:1;index:idx_odds_quotes_state_start,priority:3"`
	HomeTeam       string     `json:"home_team"`
	AwayTeam       string     `json:"away_team"`
	LeagueName     string     `json:"league_name" gorm:"index"`
	Sport          string     `json:"sport"`
	MarketID       string     `json:"market_id" gorm:"index:idx_odds_quotes_fixture_market_outcome,priority:2"`
	MarketMarker   string     `json:"market_marker" gorm:"index:idx_odds_quotes_current_key,priority:2"`
	MarketName     string     `json:"market_name"`
	OutcomeID      string     `json:"outcome_id" gorm:"index:idx_odds_quotes_fixture_market_outcome,priority:3"`
	OutcomeMarker  string     `json:"outcome_marker" gorm:"index:idx_odds_quotes_current_key,priority:3"`
	OutcomeName    string     `json:"outcome_name"`
	Odds           float64    `json:"odds"`
	AvailableStake float64    `json:"available_stake"`
	Suspended      bool       `json:"suspended"`
	MatchState     string     `json:"match_state" gorm:"index:idx_odds_quotes_state_start,priority:1"`
	EventStartAt   *time.Time `json:"event_start_at,omitempty" gorm:"index:idx_odds_quotes_state_start,priority:2"`
	CollectedAt    time.Time  `json:"collected_at" gorm:"index:idx_odds_quotes_fixture_collected_at,priority:2,sort:desc"`
	LastObservedAt time.Time  `json:"last_observed_at"`
	ChangedAt      time.Time  `json:"changed_at"`
}

type SurebetLeg struct {
	BookmakerID string    `json:"bookmaker_id"`
	LobbyID     string    `json:"lobby_id"`
	FixtureID   string    `json:"fixture_id"`
	MarketID    string    `json:"market_id"`
	OutcomeID   string    `json:"outcome_id"`
	OutcomeName string    `json:"outcome_name"`
	Odds        float64   `json:"odds"`
	Stake       float64   `json:"stake"`
	ObservedAt  time.Time `json:"observed_at,omitempty"`
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

type TelegramRecipient struct {
	ID                             uint64     `json:"id" gorm:"primaryKey"`
	Name                           string     `json:"name"`
	ChatID                         string     `json:"chat_id" gorm:"column:chat_id"`
	IsActive                       bool       `json:"is_active" gorm:"column:is_active"`
	Notes                          string     `json:"notes"`
	Source                         string     `json:"source"`
	ChatType                       string     `json:"chat_type" gorm:"column:chat_type"`
	TelegramUsername               string     `json:"telegram_username" gorm:"column:telegram_username"`
	MembershipStatus               string     `json:"membership_status" gorm:"column:membership_status"`
	ReceivesOneNegativeOnePositive bool       `json:"receives_one_negative_one_positive" gorm:"column:receives_one_negative_one_positive;default:true"`
	ReceivesTwoNegative            bool       `json:"receives_two_negative" gorm:"column:receives_two_negative;default:true"`
	LastSeenAt                     *time.Time `json:"last_seen_at,omitempty" gorm:"column:last_seen_at"`
	CreatedAt                      time.Time  `json:"created_at"`
	UpdatedAt                      time.Time  `json:"updated_at"`
}

type TelegramNotificationLog struct {
	ID               string     `json:"id" gorm:"primaryKey"`
	RecipientID      uint64     `json:"recipient_id" gorm:"column:recipient_id"`
	OpportunityID    string     `json:"opportunity_id" gorm:"column:opportunity_id"`
	FixtureID        string     `json:"fixture_id" gorm:"column:fixture_id"`
	MarketName       string     `json:"market_name" gorm:"column:market_name"`
	ProfitPercentage float64    `json:"profit_percentage" gorm:"column:profit_percentage"`
	Status           string     `json:"status"`
	AttemptCount     int        `json:"attempt_count" gorm:"column:attempt_count"`
	ErrorMessage     string     `json:"error_message" gorm:"column:error_message"`
	Message          string     `json:"message"`
	AvailableAt      *time.Time `json:"available_at,omitempty" gorm:"column:available_at"`
	ReservedAt       *time.Time `json:"reserved_at,omitempty" gorm:"column:reserved_at"`
	SentAt           time.Time  `json:"sent_at" gorm:"column:sent_at"`
	CreatedAt        time.Time  `json:"created_at"`
	UpdatedAt        time.Time  `json:"updated_at"`
}
