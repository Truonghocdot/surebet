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
	return db.AutoMigrate(
		&models.User{},
		&models.Bookmaker{},
		&models.Account{},
		&models.Session{},
		&models.OddsQuote{},
		&models.BetOrder{},
		&models.BetOrderLeg{},
		&models.BetResult{},
		&models.AuditLog{},
		&models.FeatureFlag{},
		&models.Configuration{},
	)
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
