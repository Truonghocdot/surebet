package main

import (
	"context"
	"errors"
	"net/http"
	"os"
	"time"

	"surebet/backend/internal/api"
	"surebet/backend/internal/auth"
	"surebet/backend/internal/calculator"
	"surebet/backend/internal/collector"
	"surebet/backend/internal/config"
	"surebet/backend/internal/logger"
	"surebet/backend/internal/odds"
	"surebet/backend/internal/realtime"
	"surebet/backend/internal/repository/gormstore"
	"surebet/backend/internal/repository/redisstore"
	"surebet/backend/internal/runtimeconfig"
	"surebet/backend/internal/surebet"
	"surebet/backend/internal/telegram"
	"surebet/backend/pkg/health"
)

func main() {
	cfg := config.LoadFromEnv()
	log := logger.NewStdLogger(os.Stdout, "api")

	db, err := gormstore.Open(cfg.Postgres)
	if err != nil {
		log.Error("failed to open postgres", "error", err.Error())
		os.Exit(1)
	}
	if err := gormstore.EnsureTelegramRecipientSchema(db); err != nil {
		log.Error("failed to ensure telegram recipient schema", "error", err.Error())
		os.Exit(1)
	}
	redisClient, err := redisstore.Open(cfg.Redis)
	if err != nil {
		log.Error("failed to open redis", "error", err.Error())
		os.Exit(1)
	}

	passwordHasher := auth.NewSHA256Hasher()
	tokenManager := auth.NewHMACTokenManager(cfg.Auth.TokenSecret, cfg.Auth.TokenTTL)

	userRepository := gormstore.NewUserRepository(db)
	oddsStateRepository := redisstore.NewOddsStateRepository(redisClient)
	verifiedSurebetRepository := redisstore.NewVerifiedSurebetRepository(redisClient)
	warmCtx, warmCancel := context.WithTimeout(context.Background(), 60*time.Second)
	if err := oddsStateRepository.WarmCurrentCache(warmCtx); err != nil {
		warmCancel()
		log.Error("failed to warm redis odds cache", "error", err.Error())
		os.Exit(1)
	}
	warmCancel()
	runtimeSettingRepository := gormstore.NewRuntimeSettingRepository(db)
	telegramRecipientRepository := gormstore.NewTelegramRecipientRepository(db)
	telegramLogRepository := gormstore.NewTelegramNotificationLogRepository(db)
	realtimeHub := realtime.NewHub(log)
	go realtimeHub.Run()
	go func() {
		if err := oddsStateRepository.RunJanitor(context.Background()); err != nil && !errors.Is(err, context.Canceled) {
			log.Error("redis odds janitor stopped", "error", err.Error())
		}
	}()
	collectorConfigService := runtimeconfig.NewService(
		runtimeSettingRepository,
		cfg.Collector,
	)
	detector := calculator.NewDetectorWithLogger(log)
	surebetQuery := surebet.NewQueryService(oddsStateRepository, detector)
	telegramNotifier := telegram.NewNotifier(
		cfg.Telegram,
		telegramRecipientRepository,
		telegramLogRepository,
		log,
	)
	telegramAdmin := telegram.NewAdminService(telegramRecipientRepository)
	telegramWebhook := telegram.NewWebhookService(
		cfg.Telegram,
		telegramRecipientRepository,
	)

	collectorStream := collector.NewStreamService(
		oddsStateRepository,
		collector.NewMultiEventPublisher(
			collector.NewLoggingEventPublisher(log),
			collector.NewRealtimeEventPublisher(realtimeHub),
		),
		nil,
		log,
	)
	confirmationService := surebet.NewConfirmationServiceWithConfig(
		surebetQuery,
		collectorStream,
		detector,
		cfg.Telegram,
		verifiedSurebetRepository,
	)
	verificationService := surebet.NewVerificationService(
		cfg.Telegram,
		surebetQuery,
		confirmationService,
		verifiedSurebetRepository,
		telegramNotifier,
		realtimeHub,
		collectorStream,
		log,
	)
	collectorStream.SetNotifier(
		collector.NewMultiSurebetNotifier(surebetQuery, verificationService),
	)
	verifiedSurebetQuery := surebet.NewVerifiedQueryService(
		surebetQuery,
		verifiedSurebetRepository,
	)

	server := api.NewServer(cfg.HTTP, api.Dependencies{
		Health: health.NewStaticReporter(cfg.App.Name),
		Logger: log,
		AuthLogin: auth.NewLoginService(
			userRepository,
			passwordHasher,
			tokenManager,
		),
		AuthTokens:      tokenManager,
		CollectorConfig: collectorConfigService,
		OddsQuery:       odds.NewQueryService(oddsStateRepository),
		CollectorStream: collectorStream,
		SurebetConfirm:  confirmationService,
		InternalToken:   cfg.Telegram.BotToken,
		TelegramAdmin:   telegramAdmin,
		TelegramWebhook: telegramWebhook,
		Realtime:        realtimeHub,
		SurebetQuery:    verifiedSurebetQuery,
	})

	log.Info("api service configured", "service", cfg.App.Name, "env", cfg.App.Env, "addr", server.Addr())

	if err := server.Run(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Error("api service exited", "error", err.Error())
		os.Exit(1)
	}
}
