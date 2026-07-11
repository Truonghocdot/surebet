package config

import (
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"time"

	"github.com/joho/godotenv"
)

type Config struct {
	App      AppConfig
	Auth     AuthConfig
	HTTP     HTTPConfig
	Telegram TelegramConfig
	RabbitMQ RabbitMQConfig
	Redis    RedisConfig
	Postgres PostgresConfig
	Runtime  RuntimeConfig
}

type AppConfig struct {
	Name string
	Env  string
}

type AuthConfig struct {
	TokenSecret string
	TokenTTL    time.Duration
}

type HTTPConfig struct {
	Address      string
	ReadTimeout  time.Duration
	WriteTimeout time.Duration
}

type TelegramConfig struct {
	BotToken       string
	APIBaseURL     string
	RequestTimeout time.Duration
	DedupWindow    time.Duration
	ScanCooldown   time.Duration
}

type RabbitMQConfig struct {
	URL          string
	Prefetch     int
	ExchangeName string
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

var loadDotEnvOnce sync.Once

func LoadFromEnv() Config {
	loadDotEnv()

	return Config{
		App: AppConfig{
			Name: envString("APP_NAME", "surebet-platform"),
			Env:  envString("APP_ENV", "development"),
		},
		Auth: AuthConfig{
			TokenSecret: envString("AUTH_TOKEN_SECRET", "surebet-dev-secret-change-me"),
			TokenTTL:    envDuration("AUTH_TOKEN_TTL", 12*time.Hour),
		},
		HTTP: HTTPConfig{
			Address:      envString("HTTP_ADDRESS", ":8080"),
			ReadTimeout:  envDuration("HTTP_READ_TIMEOUT", 15*time.Second),
			WriteTimeout: envDuration("HTTP_WRITE_TIMEOUT", 15*time.Second),
		},
		Telegram: TelegramConfig{
			BotToken:       envString("TELEGRAM_BOT_TOKEN", ""),
			APIBaseURL:     envString("TELEGRAM_API_BASE_URL", "https://api.telegram.org"),
			RequestTimeout: envDuration("TELEGRAM_REQUEST_TIMEOUT", 10*time.Second),
			DedupWindow:    envDuration("TELEGRAM_SUREBET_DEDUP_WINDOW", 30*time.Minute),
			ScanCooldown:   envDuration("TELEGRAM_SUREBET_SCAN_COOLDOWN", 5*time.Second),
		},
		RabbitMQ: RabbitMQConfig{
			URL:          envString("RABBITMQ_URL", "amqp://guest:guest@localhost:5672/"),
			Prefetch:     envInt("RABBITMQ_PREFETCH", 32),
			ExchangeName: envString("RABBITMQ_EXCHANGE", "surebet.domain"),
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
				"AUTO_BET":            envBool("AUTO_BET", false),
				"MANUAL_CONFIRMATION": envBool("MANUAL_CONFIRMATION", true),
				"RISK_VALIDATION":     envBool("RISK_VALIDATION", true),
				"MAX_STAKE_CHECK":     envBool("MAX_STAKE_CHECK", true),
				"BALANCE_CHECK":       envBool("BALANCE_CHECK", true),
				"ODDS_RECHECK":        envBool("ODDS_RECHECK", true),
				"LIQUIDITY_CHECK":     envBool("LIQUIDITY_CHECK", true),
				"BOOKMAKER_ENABLE":    envBool("BOOKMAKER_ENABLE", true),
			},
		},
	}
}

func envString(key, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	return value
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
