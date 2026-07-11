package collector

import (
	"context"
	"time"

	"github.com/google/uuid"

	"surebet/backend/internal/eventbus"
	"surebet/backend/internal/logger"
	"surebet/backend/internal/models"
	"surebet/backend/internal/realtime"
)

type EventPublisher interface {
	PublishOddsUpdated(ctx context.Context, event eventbus.OddsUpdatedEvent) error
}

type MultiEventPublisher struct {
	publishers []EventPublisher
}

func NewMultiEventPublisher(publishers ...EventPublisher) EventPublisher {
	filtered := make([]EventPublisher, 0, len(publishers))
	for _, publisher := range publishers {
		if publisher != nil {
			filtered = append(filtered, publisher)
		}
	}
	return MultiEventPublisher{publishers: filtered}
}

func (p MultiEventPublisher) PublishOddsUpdated(ctx context.Context, event eventbus.OddsUpdatedEvent) error {
	for _, publisher := range p.publishers {
		if err := publisher.PublishOddsUpdated(ctx, event); err != nil {
			return err
		}
	}
	return nil
}

type LoggingEventPublisher struct {
	log logger.Logger
}

func NewLoggingEventPublisher(log logger.Logger) EventPublisher {
	return LoggingEventPublisher{log: log}
}

func (p LoggingEventPublisher) PublishOddsUpdated(ctx context.Context, event eventbus.OddsUpdatedEvent) error {
	p.log.Info(
		"odds updated published",
		"type", event.Type,
		"collector_id", event.Payload.CollectorID,
		"bookmaker_id", event.Payload.BookmakerID,
		"lobby_id", event.Payload.LobbyID,
		"quotes", len(event.Payload.Quotes),
	)
	return nil
}

type RealtimeBroadcaster interface {
	Broadcast(event realtime.Event)
}

type RealtimeEventPublisher struct {
	broadcaster RealtimeBroadcaster
}

func NewRealtimeEventPublisher(broadcaster RealtimeBroadcaster) EventPublisher {
	return RealtimeEventPublisher{broadcaster: broadcaster}
}

func (p RealtimeEventPublisher) PublishOddsUpdated(ctx context.Context, event eventbus.OddsUpdatedEvent) error {
	if p.broadcaster == nil {
		return nil
	}

	p.broadcaster.Broadcast(realtime.Event{
		Type:    "odds_updated",
		SentAt:  time.Now().UTC(),
		Payload: event,
	})
	return nil
}

func BuildOddsUpdatedEvent(sourceID, bookmakerID, lobbyID string, quotes []models.OddsQuote) eventbus.OddsUpdatedEvent {
	payloadQuotes := make([]eventbus.OddsQuotePayload, 0, len(quotes))
	for _, quote := range quotes {
		payloadQuotes = append(payloadQuotes, eventbus.OddsQuotePayload{
			BookmakerID:    quote.BookmakerID,
			LobbyID:        quote.LobbyID,
			FixtureID:      quote.FixtureID,
			HomeTeam:       quote.HomeTeam,
			AwayTeam:       quote.AwayTeam,
			MarketID:       quote.MarketID,
			OutcomeID:      quote.OutcomeID,
			Odds:           quote.Odds,
			AvailableStake: quote.AvailableStake,
			CollectedAt:    quote.CollectedAt,
		})
	}

	now := time.Now().UTC()
	return eventbus.OddsUpdatedEvent{
		Type: eventbus.EventOddsUpdated,
		Metadata: eventbus.Metadata{
			EventID:       uuid.NewString(),
			TraceID:       uuid.NewString(),
			CorrelationID: uuid.NewString(),
			Producer:      "collector.ingest",
			Version:       1,
			OccurredAt:    now,
		},
		Payload: eventbus.OddsUpdatedPayload{
			CollectorID: sourceID,
			BookmakerID: bookmakerID,
			LobbyID:     lobbyID,
			Quotes:      payloadQuotes,
		},
	}
}
