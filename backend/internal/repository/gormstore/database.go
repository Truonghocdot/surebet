package gormstore

import (
	"errors"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"

	"surebet/backend/internal/config"
	"surebet/backend/internal/models"
	"surebet/backend/internal/repository"
)

func Open(cfg config.PostgresConfig) (*gorm.DB, error) {
	db, err := gorm.Open(postgres.Open(cfg.DSN), &gorm.Config{})
	if err != nil {
		return nil, err
	}

	return db, nil
}

func OpenAndMigrate(cfg config.PostgresConfig) (*gorm.DB, error) {
	db, err := Open(cfg)
	if err != nil {
		return nil, err
	}

	if err := AutoMigrate(db); err != nil {
		return nil, err
	}

	return db, nil
}

func AutoMigrate(db *gorm.DB) error {
	if err := db.AutoMigrate(
		&models.User{},
		&models.OddsQuote{},
	); err != nil {
		return err
	}

	return ensureOddsQuoteIndexes(db)
}

func mapError(err error) error {
	if err == nil {
		return nil
	}

	if errors.Is(err, gorm.ErrRecordNotFound) {
		return repository.ErrNotFound
	}

	return err
}

func ensureOddsQuoteIndexes(db *gorm.DB) error {
	return db.Exec(`
		CREATE INDEX IF NOT EXISTS idx_odds_quotes_active_current_snapshot
		ON odds_quotes (
			match_state,
			bookmaker_id,
			lobby_id,
			fixture_marker,
			market_marker,
			outcome_marker,
			collected_at DESC
		)
		WHERE suspended = false AND odds <> 0;

		CREATE INDEX IF NOT EXISTS idx_odds_quotes_live_current_snapshot_key
		ON odds_quotes (
			bookmaker_id,
			lobby_id,
			fixture_marker,
			market_marker,
			outcome_marker,
			collected_at DESC
		)
		WHERE match_state IN ('upcoming', 'live', 'unknown')
		  AND suspended = false
		  AND odds <> 0;

		CREATE INDEX IF NOT EXISTS idx_odds_quotes_current_snapshot_key
		ON odds_quotes (
			bookmaker_id,
			lobby_id,
			fixture_marker,
			market_marker,
			outcome_marker,
			collected_at DESC
		)
		WHERE match_state IN ('upcoming', 'live', 'unknown');

		CREATE INDEX IF NOT EXISTS idx_odds_quotes_state_start_window
		ON odds_quotes (
			match_state,
			event_start_at,
			collected_at DESC
		)
		WHERE suspended = false AND odds <> 0;
	`).Error
}
