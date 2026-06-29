package main

import (
	"context"
	"os"

	"surebet/backend/internal/auth"
	"surebet/backend/internal/config"
	"surebet/backend/internal/logger"
	"surebet/backend/internal/repository/gormstore"
)

func main() {
	cfg := config.LoadFromEnv()
	log := logger.NewStdLogger(os.Stdout, "seed")

	db, err := gormstore.OpenAndMigrate(cfg.Postgres)
	if err != nil {
		log.Error("failed to open or migrate postgres", "error", err.Error())
		os.Exit(1)
	}

	if err := gormstore.SeedDefaultData(context.Background(), db, auth.NewSHA256Hasher()); err != nil {
		log.Error("failed to seed dev data", "error", err.Error())
		os.Exit(1)
	}

	log.Info("dev seed completed", "service", cfg.App.Name)
}
