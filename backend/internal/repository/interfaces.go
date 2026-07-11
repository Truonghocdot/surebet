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

type TelegramRecipientRepository interface {
	ListActive(ctx context.Context) ([]models.TelegramRecipient, error)
	ListAll(ctx context.Context) ([]models.TelegramRecipient, error)
	GetByID(ctx context.Context, id uint64) (models.TelegramRecipient, error)
	GetByChatID(ctx context.Context, chatID string) (models.TelegramRecipient, error)
	Upsert(ctx context.Context, recipient models.TelegramRecipient) error
	Save(ctx context.Context, recipient models.TelegramRecipient) (models.TelegramRecipient, error)
	DeleteByID(ctx context.Context, id uint64) error
}

var ErrNotFound = errNotFound("repository record not found")

type errNotFound string

func (e errNotFound) Error() string {
	return string(e)
}
