package collector

import (
	"context"

	"surebet/backend/internal/dto"
	"surebet/backend/internal/logger"
	"surebet/backend/internal/models"
	"surebet/backend/internal/repository"
)

type APIService interface {
	IngestBootstrap(ctx context.Context, request dto.CollectorBootstrapRequest) error
	IngestDelta(ctx context.Context, request dto.CollectorDeltaRequest) error
	Heartbeat(ctx context.Context, request dto.CollectorHeartbeatRequest) error
}

type apiService struct {
	writer    repository.OddsSnapshotRepository
	publisher EventPublisher
	log       logger.Logger
}

func NewAPIService(writer repository.OddsSnapshotRepository, publisher EventPublisher, log logger.Logger) APIService {
	return apiService{
		writer:    writer,
		publisher: publisher,
		log:       log,
	}
}

func (s apiService) IngestBootstrap(ctx context.Context, request dto.CollectorBootstrapRequest) error {
	s.log.Info("collector bootstrap ingested", "collector_id", request.Source.CollectorID, "selections", len(request.Selections))
	quotes := mapSelections(request.Source, request.CollectedAt, request.Selections)
	if err := s.writer.Upsert(ctx, quotes); err != nil {
		return err
	}
	return s.publisher.PublishOddsUpdated(
		ctx,
		BuildOddsUpdatedEvent(request.Source.CollectorID, request.Source.BookmakerID, request.Source.LobbyID, quotes),
	)
}

func (s apiService) IngestDelta(ctx context.Context, request dto.CollectorDeltaRequest) error {
	s.log.Info("collector delta ingested", "deltas", len(request.Deltas))
	quotes := make([]models.OddsQuote, 0, len(request.Deltas))
	for _, delta := range request.Deltas {
		suspended := delta.Suspended
		if delta.Op == "remove" {
			suspended = true
		}
		quotes = append(quotes, buildQuote(delta.Source, delta.CollectedAt, dto.CollectorSelection{
			FixtureID:      delta.FixtureID,
			HomeTeam:       delta.HomeTeam,
			AwayTeam:       delta.AwayTeam,
			MarketID:       delta.MarketID,
			OutcomeID:      delta.OutcomeID,
			OutcomeName:    delta.OutcomeName,
			Odds:           delta.Odds,
			AvailableStake: delta.AvailableStake,
			Suspended:      suspended,
		}))
	}
	if err := s.writer.Upsert(ctx, quotes); err != nil {
		return err
	}
	if len(request.Deltas) == 0 {
		return nil
	}
	first := request.Deltas[0]
	return s.publisher.PublishOddsUpdated(
		ctx,
		BuildOddsUpdatedEvent(first.Source.CollectorID, first.Source.BookmakerID, first.Source.LobbyID, quotes),
	)
}

func (s apiService) Heartbeat(ctx context.Context, request dto.CollectorHeartbeatRequest) error {
	s.log.Info(
		"collector heartbeat",
		"collector_id", request.CollectorID,
		"bookmaker_id", request.BookmakerID,
		"lobby_id", request.LobbyID,
	)
	return nil
}
