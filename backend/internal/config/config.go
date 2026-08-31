package config

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/joho/godotenv"
)

type Config struct {
	App               AppConfig
	Auth              AuthConfig
	Collector         CollectorRuntimeConfig
	CollectorStream   CollectorStreamAuthConfig
	HTTP              HTTPConfig
	InternalToken     string
	Surebet           SurebetConfig
	AutoBetSimulation AutoBetSimulationConfig
	AutoBetLive       AutoBetLiveConfig
	Redis             RedisConfig
	Postgres          PostgresConfig
	Runtime           RuntimeConfig
	Odds              OddsConfig
}

type AppConfig struct {
	Name string
	Env  string
}

type AuthConfig struct {
	TokenSecret string
	TokenTTL    time.Duration
}

type CollectorRuntimeConfig struct {
	EightXBetBaseURL       string
	EightXBetInplayPageURL string
	Jun88BaseURL           string
	Jun88CmdPageURL        string
}

type CollectorStreamCredential struct {
	CollectorID string
	BookmakerID string
	LobbyID     string
	AccountID   string
	Token       string
}

type CollectorStreamAuthConfig struct {
	Required    bool
	Credentials []CollectorStreamCredential
}

type HTTPConfig struct {
	Address      string
	ReadTimeout  time.Duration
	WriteTimeout time.Duration
}

type SurebetConfig struct {
	VerificationMode     string
	ConfirmationTimeout  time.Duration
	ConfirmationValidity time.Duration
	ConfirmationMaxSkew  time.Duration
	ShadowDuration       time.Duration
	ShadowMinSamples     int
	ShadowMinSuccessRate float64
	ShadowMaxP95Latency  time.Duration
}

type AutoBetSimulationConfig struct {
	Enabled        bool
	TotalStakeVND  int64
	CommandTimeout time.Duration
}

// AutoBetLiveConfig is fail-closed: Enabled alone is not enough to submit.
// CommitEnabled must also be set after prepare-only validation has completed.
type AutoBetLiveConfig struct {
	Enabled             bool
	CommitEnabled       bool
	AccountID           string
	TotalStakeVND       int64
	CommandTimeout      time.Duration
	MaxJun88Reprices    int
	MaxOpenExposures    int
	MaxDailyTurnoverVND int64
	BalanceFloorVND     int64
	LeaseDuration       time.Duration
}

type RedisConfig struct {
	Address  string
	Database int
	Password string
}

type PostgresConfig struct {
	DSN string
}

type RuntimeConfig struct {
	ShutdownGrace   time.Duration
	FeatureDefaults map[string]bool
}

type OddsConfig struct {
	StateProtocol string
}

var loadDotEnvOnce sync.Once

func LoadFromEnv() Config {
	loadDotEnv()
	autoBetMode := normalizeAutoBetMode(envString("AUTO_BET_MODE", "off"))
	autoBetTotalStakeVND := int64(envInt("AUTO_BET_TOTAL_STAKE_VND", 100_000))
	if autoBetTotalStakeVND < 0 {
		autoBetTotalStakeVND = 0
	}

	return Config{
		App: AppConfig{
			Name: envString("APP_NAME", "surebet-platform"),
			Env:  envString("APP_ENV", "development"),
		},
		Auth: AuthConfig{
			TokenSecret: envString("AUTH_TOKEN_SECRET", "surebet-dev-secret-change-me"),
			TokenTTL:    envDuration("AUTH_TOKEN_TTL", 12*time.Hour),
		},
		Collector: CollectorRuntimeConfig{
			EightXBetBaseURL:       envString("EIGHTXBET_BASE_URL", ""),
			EightXBetInplayPageURL: envString("EIGHTXBET_INPLAY_PAGE_URL", ""),
			Jun88BaseURL:           envString("JUN88_BASE_URL", ""),
			Jun88CmdPageURL:        envString("JUN88_CMD_PAGE_URL", ""),
		},
		CollectorStream: CollectorStreamAuthConfig{
			Required: envBool("COLLECTOR_STREAM_AUTH_REQUIRED", false),
			Credentials: []CollectorStreamCredential{
				{
					CollectorID: "jun88-cmd", BookmakerID: "jun88", LobbyID: "cmd",
					AccountID: envString("JUN88_ACCOUNT_ID", ""),
					Token:     envString("COLLECTOR_STREAM_JUN88_TOKEN", ""),
				},
				{
					CollectorID: "8xbet", BookmakerID: "8xbet", LobbyID: "default",
					AccountID: envString("EIGHTXBET_ACCOUNT_ID", ""),
					Token:     envString("COLLECTOR_STREAM_EIGHTXBET_TOKEN", ""),
				},
			},
		},
		HTTP: HTTPConfig{
			Address:      envString("HTTP_ADDRESS", ":8080"),
			ReadTimeout:  envDuration("HTTP_READ_TIMEOUT", 15*time.Second),
			WriteTimeout: envDuration("HTTP_WRITE_TIMEOUT", 15*time.Second),
		},
		InternalToken: envString("INTERNAL_API_TOKEN", ""),
		Surebet: SurebetConfig{
			VerificationMode:     envString("SUREBET_VERIFICATION_MODE", "shadow"),
			ConfirmationTimeout:  envDuration("SUREBET_CONFIRM_TIMEOUT", 2*time.Second),
			ConfirmationValidity: envDuration("SUREBET_CONFIRM_VALIDITY", 2*time.Second),
			ConfirmationMaxSkew:  envDuration("SUREBET_CONFIRM_MAX_SKEW", time.Second),
			ShadowDuration:       envDuration("SUREBET_SHADOW_DURATION", 30*time.Minute),
			ShadowMinSamples:     envInt("SUREBET_SHADOW_MIN_SAMPLES", 20),
			ShadowMinSuccessRate: envFloat("SUREBET_SHADOW_MIN_SUCCESS_RATE", 0.80),
			ShadowMaxP95Latency:  envDuration("SUREBET_SHADOW_MAX_P95_LATENCY", 1500*time.Millisecond),
		},
		AutoBetSimulation: AutoBetSimulationConfig{
			Enabled:        autoBetMode == "simulation",
			TotalStakeVND:  autoBetTotalStakeVND,
			CommandTimeout: 2 * time.Second,
		},
		AutoBetLive: AutoBetLiveConfig{
			Enabled:             autoBetMode == "dry-run" || autoBetMode == "live",
			CommitEnabled:       autoBetMode == "live",
			AccountID:           "surebet-primary",
			TotalStakeVND:       autoBetTotalStakeVND,
			CommandTimeout:      5 * time.Second,
			MaxJun88Reprices:    3,
			MaxOpenExposures:    1,
			MaxDailyTurnoverVND: autoBetTotalStakeVND * 10,
			BalanceFloorVND:     0,
			LeaseDuration:       30 * time.Second,
		},
		Redis: RedisConfig{
			Address:  envString("REDIS_ADDRESS", "localhost:6379"),
			Database: envInt("REDIS_DB", 0),
			Password: envString("REDIS_PASSWORD", ""),
		},
		Postgres: PostgresConfig{
			DSN: envString("POSTGRES_DSN", "postgres://surebet:surebet@localhost:5432/surebet?sslmode=disable"),
		},
		Runtime: RuntimeConfig{
			ShutdownGrace: envDuration("SHUTDOWN_GRACE", 10*time.Second),
			FeatureDefaults: map[string]bool{
				"AUTO_BET":            false,
				"MANUAL_CONFIRMATION": envBool("MANUAL_CONFIRMATION", true),
				"RISK_VALIDATION":     envBool("RISK_VALIDATION", true),
				"MAX_STAKE_CHECK":     envBool("MAX_STAKE_CHECK", true),
				"BALANCE_CHECK":       envBool("BALANCE_CHECK", true),
				"ODDS_RECHECK":        envBool("ODDS_RECHECK", true),
				"LIQUIDITY_CHECK":     envBool("LIQUIDITY_CHECK", true),
				"BOOKMAKER_ENABLE":    envBool("BOOKMAKER_ENABLE", true),
			},
		},
		Odds: OddsConfig{
			StateProtocol: envString("ODDS_STATE_PROTOCOL", "v1"),
		},
	}
}

func normalizeAutoBetMode(value string) string {
	mode := strings.ToLower(strings.TrimSpace(value))
	switch mode {
	case "simulation", "dry-run", "live":
		return mode
	default:
		return "off"
	}
}

func envString(key, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	return value
}

func envFloat(key string, fallback float64) float64 {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseFloat(value, 64)
	if err != nil {
		return fallback
	}
	return parsed
}

func loadDotEnv() {
	loadDotEnvOnce.Do(func() {
		workingDir, err := os.Getwd()
		if err != nil {
			return
		}

		for _, candidate := range envCandidates(workingDir) {
			if _, err := os.Stat(candidate); err == nil {
				_ = godotenv.Load(candidate)
				return
			}
		}
	})
}

func envCandidates(start string) []string {
	candidates := make([]string, 0, 16)
	seen := make(map[string]struct{})

	for current := start; ; current = filepath.Dir(current) {
		for _, candidate := range []string{
			filepath.Join(current, ".env"),
			filepath.Join(current, "backend", ".env"),
		} {
			if _, ok := seen[candidate]; ok {
				continue
			}

			seen[candidate] = struct{}{}
			candidates = append(candidates, candidate)
		}

		parent := filepath.Dir(current)
		if parent == current {
			break
		}
	}

	return candidates
}

func envInt(key string, fallback int) int {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback
	}

	value, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}

	return value
}

func envBool(key string, fallback bool) bool {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback
	}

	value, err := strconv.ParseBool(raw)
	if err != nil {
		return fallback
	}

	return value
}

func envDuration(key string, fallback time.Duration) time.Duration {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback
	}

	value, err := time.ParseDuration(raw)
	if err != nil {
		return fallback
	}

	return value
}
