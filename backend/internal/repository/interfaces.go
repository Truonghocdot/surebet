package repository

import (
	"context"
	"time"

	"surebet/backend/internal/models"
)

type UserRepository interface {
	GetByID(ctx context.Context, id string) (models.User, error)
	GetByEmail(ctx context.Context, email string) (models.User, error)
	List(ctx context.Context) ([]models.User, error)
	Upsert(ctx context.Context, user models.User) error
	UpdateLastLogin(ctx context.Context, id string, loggedAt time.Time) error
}

type OddsSnapshotRepository interface {
	Upsert(ctx context.Context, quotes []models.OddsQuote) error
	ListByFixture(ctx context.Context, fixtureID string) ([]models.OddsQuote, error)
}

var ErrNotFound = errNotFound("repository record not found")

type errNotFound string

func (e errNotFound) Error() string {
	return string(e)
}
