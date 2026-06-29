package collector

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"

	"surebet/backend/internal/dto"
	"surebet/backend/internal/models"
)

type SnapshotWriter interface {
	Upsert(ctx context.Context, quotes []models.OddsQuote) error
}

type ingestionService struct {
	writer SnapshotWriter
}

func NewIngestionService(writer SnapshotWriter) IngestionService {
	return ingestionService{
		writer: writer,
	}
}

func (s ingestionService) Ingest(ctx context.Context, payload Payload) error {
	quotes := make([]models.OddsQuote, 0)
	_ = ctx
	_ = payload
	return s.writer.Upsert(ctx, quotes)
}

func IngestBootstrap(ctx context.Context, writer SnapshotWriter, request dto.CollectorBootstrapRequest) error {
	return writer.Upsert(ctx, mapSelections(request.Source, request.CollectedAt, request.Selections))
}

func IngestDelta(ctx context.Context, writer SnapshotWriter, request dto.CollectorDeltaRequest) error {
	quotes := make([]models.OddsQuote, 0, len(request.Deltas))
	for _, delta := range request.Deltas {
		if strings.EqualFold(delta.Op, "remove") {
			quotes = append(quotes, buildQuote(delta.Source, delta.CollectedAt, dto.CollectorSelection{
				FixtureID:      delta.FixtureID,
				MarketID:       delta.MarketID,
				OutcomeID:      delta.OutcomeID,
				OutcomeName:    delta.OutcomeName,
				Odds:           delta.Odds,
				AvailableStake: delta.AvailableStake,
				Suspended:      true,
			}))
			continue
		}

		quotes = append(quotes, buildQuote(delta.Source, delta.CollectedAt, dto.CollectorSelection{
			FixtureID:      delta.FixtureID,
			MarketID:       delta.MarketID,
			OutcomeID:      delta.OutcomeID,
			OutcomeName:    delta.OutcomeName,
			Odds:           delta.Odds,
			AvailableStake: delta.AvailableStake,
			Suspended:      delta.Suspended,
		}))
	}

	return writer.Upsert(ctx, quotes)
}

func mapSelections(source dto.CollectorSource, collectedAt time.Time, selections []dto.CollectorSelection) []models.OddsQuote {
	quotes := make([]models.OddsQuote, 0, len(selections))
	for _, selection := range selections {
		quotes = append(quotes, buildQuote(source, collectedAt, selection))
	}
	return quotes
}

func buildQuote(source dto.CollectorSource, collectedAt time.Time, selection dto.CollectorSelection) models.OddsQuote {
	return models.OddsQuote{
		ID:             quoteID(source.BookmakerID, source.LobbyID, selection.FixtureID, selection.MarketID, selection.OutcomeID),
		BookmakerID:    source.BookmakerID,
		LobbyID:        source.LobbyID,
		FixtureID:      selection.FixtureID,
		Sport:          "",
		MarketID:       selection.MarketID,
		MarketName:     selection.MarketID,
		OutcomeID:      selection.OutcomeID,
		OutcomeName:    selection.OutcomeName,
		Odds:           selection.Odds,
		AvailableStake: selection.AvailableStake,
		Suspended:      selection.Suspended,
		CollectedAt:    collectedAt.UTC(),
	}
}

func quoteID(bookmakerID, lobbyID, fixtureID, marketID, outcomeID string) string {
	return uuid.NewSHA1(uuid.Nil, []byte(strings.Join([]string{
		bookmakerID,
		lobbyID,
		fixtureID,
		marketID,
		outcomeID,
	}, "|"))).String()
}
