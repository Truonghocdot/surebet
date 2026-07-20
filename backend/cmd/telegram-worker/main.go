package main

import (
	"context"
	"errors"
	"os"
	"os/signal"
	"syscall"

	"surebet/backend/internal/config"
	"surebet/backend/internal/logger"
	"surebet/backend/internal/repository/gormstore"
	"surebet/backend/internal/telegram"
)

func main() {
	cfg := config.LoadFromEnv()
	log := logger.NewStdLogger(os.Stdout, "telegram-worker")

	db, err := gormstore.Open(cfg.Postgres)
	if err != nil {
		log.Error("failed to open postgres", "error", err.Error())
		os.Exit(1)
	}
	if err := gormstore.EnsureTelegramRecipientSchema(db); err != nil {
		log.Error("failed to ensure telegram recipient schema", "error", err.Error())
		os.Exit(1)
	}

	recipientRepository := gormstore.NewTelegramRecipientRepository(db)
	queueRepository := gormstore.NewTelegramNotificationLogRepository(db)
	surebetReader := telegram.NewBackendVerifiedSurebetReader(
		cfg.Telegram.BackendAPIURL,
		cfg.Telegram.BotToken,
		cfg.Telegram.RequestTimeout,
	)
	worker := telegram.NewWorker(cfg.Telegram, recipientRepository, queueRepository, surebetReader, log)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	if worker == nil {
		log.Warn("telegram worker disabled", "reason", "missing TELEGRAM_BOT_TOKEN")
		<-ctx.Done()
		return
	}

	log.Info("telegram worker started")
	if err := worker.Run(ctx); err != nil && !errors.Is(err, context.Canceled) {
		log.Error("telegram worker exited", "error", err.Error())
		os.Exit(1)
	}
}
