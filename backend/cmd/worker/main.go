package main

import (
	"os"
	"strings"

	"surebet/backend/internal/config"
	"surebet/backend/internal/eventbus"
	"surebet/backend/internal/logger"
)

func main() {
	cfg := config.LoadFromEnv()
	log := logger.NewStdLogger(os.Stdout, "worker")

	log.Info(
		"worker scaffold configured",
		"service", cfg.App.Name,
		"env", cfg.App.Env,
		"queues", strings.Join(eventbus.QueueNames(), ","),
		"auto_bet_default", cfg.Runtime.FeatureDefaults["AUTO_BET"],
	)
}
