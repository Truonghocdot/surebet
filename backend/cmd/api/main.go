package main

import (
	"errors"
	"net/http"
	"os"

	"surebet/backend/internal/api"
	"surebet/backend/internal/auth"
	"surebet/backend/internal/config"
	"surebet/backend/internal/collector"
	"surebet/backend/internal/configuration"
	"surebet/backend/internal/logger"
	"surebet/backend/internal/odds"
	"surebet/backend/internal/repository/gormstore"
	"surebet/backend/pkg/health"
)

func main() {
	cfg := config.LoadFromEnv()
	log := logger.NewStdLogger(os.Stdout, "api")

	db, err := gormstore.OpenAndMigrate(cfg.Postgres)
	if err != nil {
		log.Error("failed to open or migrate postgres", "error", err.Error())
		os.Exit(1)
	}

	passwordHasher := auth.NewSHA256Hasher()
	tokenManager := auth.NewHMACTokenManager(cfg.Auth.TokenSecret, cfg.Auth.TokenTTL)

	userRepository := gormstore.NewUserRepository(db)
	accountRepository := gormstore.NewAccountRepository(db)
	bookmakerRepository := gormstore.NewBookmakerRepository(db)
	configurationRepository := gormstore.NewConfigurationRepository(db)
	oddsSnapshotRepository := gormstore.NewOddsSnapshotRepository(db)

	server := api.NewServer(cfg.HTTP, api.Dependencies{
		Health: health.NewStaticReporter(cfg.App.Name),
		Logger: log,
		AuthLogin: auth.NewLoginService(
			userRepository,
			passwordHasher,
			tokenManager,
		),
		ConfigQuery: configuration.NewQueryService(
			bookmakerRepository,
			accountRepository,
			configurationRepository,
		),
		ConfigWrite: configuration.NewSettingsService(
			bookmakerRepository,
			accountRepository,
		),
		OddsQuery: odds.NewQueryService(oddsSnapshotRepository),
		CollectorIngest: collector.NewAPIService(
			oddsSnapshotRepository,
			collector.NewLoggingEventPublisher(log),
			log,
		),
	})

	log.Info("api service configured", "service", cfg.App.Name, "env", cfg.App.Env, "addr", server.Addr())

	if err := server.Run(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Error("api service exited", "error", err.Error())
		os.Exit(1)
	}
}
