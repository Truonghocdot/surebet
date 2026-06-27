package odds

import (
	"context"

	"surebet/backend/internal/models"
)

type SnapshotFilter struct {
	BookmakerID string
	LobbyID     string
	FixtureID   string
}

type Service interface {
	Store(ctx context.Context, quotes []models.OddsQuote) error
	ListCurrent(ctx context.Context, filter SnapshotFilter) ([]models.OddsQuote, error)
}
