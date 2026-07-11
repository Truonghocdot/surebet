package gormstore

import (
	"errors"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"

	"surebet/backend/internal/config"
	"surebet/backend/internal/repository"
)

func Open(cfg config.PostgresConfig) (*gorm.DB, error) {
	db, err := gorm.Open(postgres.Open(cfg.DSN), &gorm.Config{})
	if err != nil {
		return nil, err
	}

	return db, nil
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
