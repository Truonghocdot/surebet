package main

import (
	"os"

	"surebet/backend/internal/config"
	"surebet/backend/internal/logger"
	"surebet/backend/internal/repository/gormstore"
)

func main() {
	cfg := config.LoadFromEnv()
	log := logger.NewStdLogger(os.Stdout, "migrate")

	db, err := gormstore.Open(cfg.Postgres)
	if err != nil {
		log.Error("failed to open postgres", "error", err.Error())
		os.Exit(1)
	}

	if err := gormstore.AutoMigrate(db); err != nil {
		log.Error("failed to migrate postgres schema", "error", err.Error())
		os.Exit(1)
	}

	log.Info("postgres schema migrated", "service", cfg.App.Name)
}
