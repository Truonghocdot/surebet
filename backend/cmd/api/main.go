package main

import (
	"context"
	"errors"
	"net/http"
	"os"
	"time"

	"surebet/backend/internal/api"
	"surebet/backend/internal/auth"
	"surebet/backend/internal/autobet"
	"surebet/backend/internal/betaction"
	"surebet/backend/internal/calculator"
	"surebet/backend/internal/collector"
	"surebet/backend/internal/config"
	"surebet/backend/internal/dto"
	"surebet/backend/internal/logger"
	"surebet/backend/internal/odds"
	"surebet/backend/internal/realtime"
	"surebet/backend/internal/repository/gormstore"
	"surebet/backend/internal/repository/redisstore"
	"surebet/backend/internal/runtimeconfig"
	"surebet/backend/internal/surebet"
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
	redisClient, err := redisstore.Open(cfg.Redis)
	if err != nil {
		log.Error("failed to open redis", "error", err.Error())
		os.Exit(1)
	}

	passwordHasher := auth.NewSHA256Hasher()
	tokenManager := auth.NewHMACTokenManager(cfg.Auth.TokenSecret, cfg.Auth.TokenTTL)

	userRepository := gormstore.NewUserRepository(db)
	oddsStateRepository := redisstore.NewOddsStateRepository(redisClient)
	oddsStateRepository.SetStateProtocol(cfg.Odds.StateProtocol)
	verifiedSurebetRepository := redisstore.NewVerifiedSurebetRepository(redisClient)
	warmCtx, warmCancel := context.WithTimeout(context.Background(), 60*time.Second)
	if err := oddsStateRepository.WarmCurrentCache(warmCtx); err != nil {
		warmCancel()
		log.Error("failed to warm redis odds cache", "error", err.Error())
		os.Exit(1)
	}
	warmCancel()
	runtimeSettingRepository := gormstore.NewRuntimeSettingRepository(db)
	betActionRepository := gormstore.NewBetActionRepository(db)
	betAttemptRepository := gormstore.NewBetAttemptRepository(db)
	betExposureRepository := gormstore.NewBetExposureRepository(db)
	betActionEventRepository := gormstore.NewBetActionEventRepository(db)
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
	collectorStream := collector.NewStreamService(
		oddsStateRepository,
		collector.NewMultiEventPublisher(
			collector.NewLoggingEventPublisher(log),
			collector.NewRealtimeEventPublisher(realtimeHub),
		),
		nil,
		log,
	)
	collectorStream.SetCollectorStreamAuth(cfg.CollectorStream)
	collectorStream.SetStateProtocol(cfg.Odds.StateProtocol)
	collectorStream.SetAccountBalanceBroadcaster(realtimeHub)
	confirmationService := surebet.NewConfirmationServiceWithConfig(
		surebetQuery,
		collectorStream,
		detector,
		cfg.Surebet,
		verifiedSurebetRepository,
	)
	verificationService := surebet.NewVerificationService(
		cfg.Surebet,
		surebetQuery,
		confirmationService,
		verifiedSurebetRepository,
		realtimeHub,
		collectorStream,
		log,
	)
	betActionService := betaction.NewService(
		betActionRepository,
		collectorStream,
		cfg.AutoBetSimulation,
		realtimeHub,
		log,
	)
	autoBetControl := autobet.NewControl(
		cfg.AutoBetSimulation.Enabled || cfg.AutoBetLive.Enabled,
		cfg.AutoBetLive.TotalStakeVND,
	)
	betActionService.SetRuntimeControl(autoBetControl)
	liveExecutionService := betaction.NewLiveExecutionService(
		betActionRepository,
		betAttemptRepository,
		betExposureRepository,
		betActionEventRepository,
		collectorStream,
		cfg.AutoBetLive,
		realtimeHub,
		log,
	)
	liveExecutionService.SetRuntimeControl(autoBetControl)
	liveBetQueries := betaction.NewLiveQueryService(
		betExposureRepository,
		betAttemptRepository,
		betActionEventRepository,
	)
	verificationService.SetAutoBetSimulation(autoBetTriggerFanout{
		betActionService,
		liveExecutionService,
	})
	collectorStream.SetNotifier(
		collector.NewMultiSurebetNotifier(
			surebetQuery,
			verificationService,
			betaction.NewExposureHedgeNotifier(liveExecutionService),
		),
	)
	if cfg.AutoBetLive.Enabled && cfg.AutoBetLive.CommitEnabled {
		go runLiveBetReconciliation(liveExecutionService, cfg.AutoBetLive.CommandTimeout, log)
	}
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
		AuthTokens:        tokenManager,
		CollectorConfig:   collectorConfigService,
		OddsQuery:         odds.NewQueryService(oddsStateRepository),
		CollectorStream:   collectorStream,
		SurebetConfirm:    confirmationService,
		InternalToken:     cfg.InternalToken,
		Realtime:          realtimeHub,
		SurebetQuery:      verifiedSurebetQuery,
		BetActions:        betActionService,
		LiveBetQueries:    liveBetQueries,
		LiveBetOperations: liveExecutionService,
		AutoBetControl:    autoBetControl,
	})

	log.Info("api service configured", "service", cfg.App.Name, "env", cfg.App.Env, "addr", server.Addr())

	if err := server.Run(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Error("api service exited", "error", err.Error())
		os.Exit(1)
	}
}

type autoBetTrigger interface {
	Trigger(dto.SurebetView)
}

type autoBetTriggerFanout []autoBetTrigger

func (triggers autoBetTriggerFanout) Trigger(item dto.SurebetView) {
	for _, trigger := range triggers {
		if trigger != nil {
			trigger.Trigger(item)
		}
	}
}

func runLiveBetReconciliation(
	service *betaction.LiveExecutionService,
	commandTimeout time.Duration,
	log logger.Logger,
) {
	if commandTimeout <= 0 {
		commandTimeout = 5 * time.Second
	}
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		ctx, cancel := context.WithTimeout(context.Background(), 4*commandTimeout)
		err := service.ReconcilePending(ctx)
		cancel()
		if err != nil && !errors.Is(err, betaction.ErrLiveExecutionDisabled) && log != nil {
			log.Warn("live bet reconciliation pass failed", "error", err.Error())
		}
		<-ticker.C
	}
}
