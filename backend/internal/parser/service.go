package parser

import (
	"context"
	"time"

	"surebet/backend/internal/models"
)

type RawSnapshot struct {
	CollectorID string
	BookmakerID string
	LobbyID     string
	Payload     []byte
	CollectedAt time.Time
}

type OddsParser interface {
	Parse(ctx context.Context, snapshot RawSnapshot) ([]models.OddsQuote, error)
}
