package main

import (
	"context"
	"os"

	"surebet/backend/internal/config"
	"surebet/backend/internal/logger"
	"surebet/backend/internal/repository/gormstore"
)

func main() {
	cfg := config.LoadFromEnv()
	log := logger.NewStdLogger(os.Stdout, "cleanup")

	db, err := gormstore.OpenAndMigrate(cfg.Postgres)
	if err != nil {
		log.Error("failed to open or migrate postgres", "error", err.Error())
		os.Exit(1)
	}

	if err := gormstore.CleanupLegacyBookmakers(context.Background(), db); err != nil {
		log.Error("failed to run legacy migration", "error", err.Error())
		os.Exit(1)
	}

	log.Info("legacy bookmaker cleanup completed", "service", cfg.App.Name)
}
