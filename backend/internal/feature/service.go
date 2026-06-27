package feature

import (
	"context"
	"time"

	"surebet/backend/internal/models"
)

type SwitchName string

const (
	AutoBet            SwitchName = "AUTO_BET"
	ManualConfirmation SwitchName = "MANUAL_CONFIRMATION"
	RiskValidation     SwitchName = "RISK_VALIDATION"
	MaxStakeCheck      SwitchName = "MAX_STAKE_CHECK"
	BalanceCheck       SwitchName = "BALANCE_CHECK"
	OddsRecheck        SwitchName = "ODDS_RECHECK"
	LiquidityCheck     SwitchName = "LIQUIDITY_CHECK"
	BookmakerEnable    SwitchName = "BOOKMAKER_ENABLE"
)

type Scope struct {
	Global      bool
	BookmakerID string
	LobbyID     string
	AccountID   string
	UserID      string
}

type Snapshot struct {
	Name        SwitchName `json:"name"`
	IsEnabled   bool       `json:"is_enabled"`
	Source      string     `json:"source"`
	EvaluatedAt time.Time  `json:"evaluated_at"`
}

type Service interface {
	IsEnabled(ctx context.Context, scope Scope, name SwitchName) (bool, error)
	List(ctx context.Context) ([]models.FeatureFlag, error)
}
