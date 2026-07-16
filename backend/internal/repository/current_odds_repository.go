package repository

import (
	"context"
	"time"

	"surebet/backend/internal/models"
)

type CurrentOddsRepository interface {
	ListByFixture(ctx context.Context, fixtureID string) ([]models.OddsQuote, error)
	ListCurrent(ctx context.Context, bookmakerID, lobbyID, fixtureID string) ([]models.OddsQuote, error)
	ListCurrentLive(ctx context.Context, bookmakerID, lobbyID, fixtureID string) ([]models.OddsQuote, error)
	ListCurrentDetectorCandidatesBySource(ctx context.Context, minCollectedAt time.Time) ([]models.OddsQuote, error)
}
