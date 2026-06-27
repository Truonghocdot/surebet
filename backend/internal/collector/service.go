package collector

import (
	"context"
	"time"

	"surebet/backend/internal/eventbus"
)

type Source struct {
	CollectorID string
	BookmakerID string
	LobbyID     string
}

type Payload struct {
	Source      Source
	Raw         []byte
	CollectedAt time.Time
}

type IngestionService interface {
	Ingest(ctx context.Context, payload Payload) error
}

type Publisher interface {
	PublishOddsUpdated(ctx context.Context, event eventbus.OddsUpdatedEvent) error
}
