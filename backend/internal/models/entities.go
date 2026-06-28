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

type Bookmaker struct {
	BaseModel
	Code          string `json:"code" gorm:"uniqueIndex;not null"`
	Name          string `json:"name"`
	SiteURL       string `json:"site_url"`
	Region        string `json:"region"`
	IsEnabled     bool   `json:"is_enabled"`
	SupportsAuto  bool   `json:"supports_auto"`
	MaxConcurrent int    `json:"max_concurrent"`
}

type Account struct {
	BaseModel
	UserID         string     `json:"user_id" gorm:"index;not null"`
	BookmakerID    string     `json:"bookmaker_id" gorm:"index;not null"`
	ExternalRef    string     `json:"external_ref" gorm:"uniqueIndex;not null"`
	Label          string     `json:"label"`
	LoginUsername  string     `json:"login_username"`
	LoginPassword  string     `json:"-"`
	Currency       string     `json:"currency"`
	Balance        float64    `json:"balance"`
	AvailableStake float64    `json:"available_stake"`
	IsEnabled      bool       `json:"is_enabled"`
	LastLoginAt    *time.Time `json:"last_login_at,omitempty"`
}

type Session struct {
	BaseModel
	AccountID     string        `json:"account_id" gorm:"index;not null"`
	Status        SessionStatus `json:"status"`
	SessionToken  string        `json:"session_token"`
	ExpiresAt     time.Time     `json:"expires_at"`
	LastSeenAt    time.Time     `json:"last_seen_at"`
	CollectorNode string        `json:"collector_node"`
}

type OddsQuote struct {
	ID             string    `json:"id"`
	BookmakerID    string    `json:"bookmaker_id"`
	LobbyID        string    `json:"lobby_id"`
	FixtureID      string    `json:"fixture_id"`
	Sport          string    `json:"sport"`
	MarketID       string    `json:"market_id"`
	MarketName     string    `json:"market_name"`
	OutcomeID      string    `json:"outcome_id"`
	OutcomeName    string    `json:"outcome_name"`
	Odds           float64   `json:"odds"`
	AvailableStake float64   `json:"available_stake"`
	Suspended      bool      `json:"suspended"`
	CollectedAt    time.Time `json:"collected_at"`
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

type BetOrder struct {
	BaseModel
	OpportunityID        string        `json:"opportunity_id" gorm:"index;not null"`
	UserID               string        `json:"user_id" gorm:"index;not null"`
	Status               BetStatus     `json:"status" gorm:"index"`
	Mode                 ExecutionMode `json:"mode"`
	RequestedBy          string        `json:"requested_by"`
	RequiresConfirmation bool          `json:"requires_confirmation"`
	ProfitPercentage     float64       `json:"profit_percentage"`
	ExpectedReturn       float64       `json:"expected_return"`
	RiskScore            int           `json:"risk_score"`
	ValidationTraceID    string        `json:"validation_trace_id"`
	ConfirmedAt          *time.Time    `json:"confirmed_at,omitempty"`
	CompletedAt          *time.Time    `json:"completed_at,omitempty"`
}

type BetOrderLeg struct {
	BaseModel
	BetOrderID    string  `json:"bet_order_id" gorm:"index;not null"`
	AccountID     string  `json:"account_id" gorm:"index;not null"`
	BookmakerID   string  `json:"bookmaker_id" gorm:"index;not null"`
	FixtureID     string  `json:"fixture_id" gorm:"index"`
	MarketID      string  `json:"market_id"`
	OutcomeID     string  `json:"outcome_id"`
	RequestedOdds float64 `json:"requested_odds"`
	Stake         float64 `json:"stake"`
}

type BetResult struct {
	BaseModel
	BetOrderID         string    `json:"bet_order_id" gorm:"index;not null"`
	BetOrderLegID      string    `json:"bet_order_leg_id" gorm:"index;not null"`
	ExternalReference  string    `json:"external_reference"`
	Accepted           bool      `json:"accepted"`
	Reason             string    `json:"reason"`
	ExecutedOdds       float64   `json:"executed_odds"`
	ExecutedStake      float64   `json:"executed_stake"`
	SettledProfit      float64   `json:"settled_profit"`
	ProviderPayloadRef string    `json:"provider_payload_ref"`
	ReceivedAt         time.Time `json:"received_at"`
}

type AuditLog struct {
	BaseModel
	EntityType string `json:"entity_type" gorm:"index"`
	EntityID   string `json:"entity_id" gorm:"index"`
	Action     string `json:"action" gorm:"index"`
	ActorType  string `json:"actor_type"`
	ActorID    string `json:"actor_id"`
	TraceID    string `json:"trace_id" gorm:"index"`
	Payload    string `json:"payload" gorm:"type:text"`
}

type FeatureFlag struct {
	BaseModel
	Name        string    `json:"name" gorm:"uniqueIndex;not null"`
	Description string    `json:"description"`
	IsEnabled   bool      `json:"is_enabled"`
	ScopeType   string    `json:"scope_type"`
	ScopeValue  string    `json:"scope_value"`
	UpdatedBy   string    `json:"updated_by"`
	EffectiveAt time.Time `json:"effective_at"`
}

type Configuration struct {
	BaseModel
	Key         string `json:"key" gorm:"uniqueIndex;not null"`
	Value       string `json:"value" gorm:"type:text"`
	ValueType   string `json:"value_type"`
	Description string `json:"description"`
}

type OddsHistory struct {
	RecordedAt     time.Time `json:"recorded_at"`
	BookmakerID    string    `json:"bookmaker_id"`
	LobbyID        string    `json:"lobby_id"`
	FixtureID      string    `json:"fixture_id"`
	MarketID       string    `json:"market_id"`
	OutcomeID      string    `json:"outcome_id"`
	Odds           float64   `json:"odds"`
	AvailableStake float64   `json:"available_stake"`
	LatencyMs      int64     `json:"latency_ms"`
}

type SurebetHistory struct {
	RecordedAt       time.Time `json:"recorded_at"`
	OpportunityID    string    `json:"opportunity_id"`
	FixtureID        string    `json:"fixture_id"`
	ProfitPercentage float64   `json:"profit_percentage"`
	ExpectedReturn   float64   `json:"expected_return"`
	Status           string    `json:"status"`
}

type ExecutionHistory struct {
	RecordedAt        time.Time `json:"recorded_at"`
	BetOrderID        string    `json:"bet_order_id"`
	BetOrderLegID     string    `json:"bet_order_leg_id"`
	Status            string    `json:"status"`
	ExternalReference string    `json:"external_reference"`
	DurationMs        int64     `json:"duration_ms"`
}

type CrawlerLatency struct {
	RecordedAt  time.Time `json:"recorded_at"`
	CollectorID string    `json:"collector_id"`
	BookmakerID string    `json:"bookmaker_id"`
	LobbyID     string    `json:"lobby_id"`
	DurationMs  int64     `json:"duration_ms"`
	Success     bool      `json:"success"`
}

type OddsLatency struct {
	RecordedAt  time.Time `json:"recorded_at"`
	BookmakerID string    `json:"bookmaker_id"`
	FixtureID   string    `json:"fixture_id"`
	DurationMs  int64     `json:"duration_ms"`
}

type RiskHistory struct {
	RecordedAt time.Time `json:"recorded_at"`
	BetOrderID string    `json:"bet_order_id"`
	RiskScore  int       `json:"risk_score"`
	Decision   string    `json:"decision"`
	Reasons    string    `json:"reasons"`
}
