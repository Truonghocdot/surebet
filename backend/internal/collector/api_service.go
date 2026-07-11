package collector

import (
	"context"
	"strings"
	"time"
	"unicode"

	"github.com/google/uuid"
	"golang.org/x/text/unicode/norm"

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
			LeagueName:     delta.LeagueName,
			MatchState:     delta.MatchState,
			EventStartAt:   delta.EventStartAt,
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
		FixtureMarker:  buildFixtureMarker(selection),
		HomeTeam:       strings.TrimSpace(selection.HomeTeam),
		AwayTeam:       strings.TrimSpace(selection.AwayTeam),
		LeagueName:     strings.TrimSpace(selection.LeagueName),
		Sport:          "",
		MarketID:       selection.MarketID,
		MarketMarker:   buildMarketMarker(selection),
		MarketName:     selection.MarketID,
		OutcomeID:      selection.OutcomeID,
		OutcomeMarker:  buildOutcomeMarker(selection),
		OutcomeName:    selection.OutcomeName,
		Odds:           selection.Odds,
		AvailableStake: selection.AvailableStake,
		Suspended:      selection.Suspended,
		MatchState:     normalizeMatchState(selection.MatchState),
		EventStartAt:   parseCollectorEventStartAt(selection.EventStartAt, collectedAt),
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

func buildFixtureMarker(selection dto.CollectorSelection) string {
	home := slugText(selection.HomeTeam)
	away := slugText(selection.AwayTeam)
	if home != "" && away != "" {
		return strings.Join([]string{home, away}, "|")
	}
	return slugText(selection.FixtureID)
}

func buildMarketMarker(selection dto.CollectorSelection) string {
	return slugText(selection.MarketID)
}

func buildOutcomeMarker(selection dto.CollectorSelection) string {
	return slugText(selection.OutcomeName)
}

func normalizeMatchState(value string) string {
	switch canonicalText(value) {
	case "upcoming":
		return "upcoming"
	case "live":
		return "live"
	case "finished":
		return "finished"
	default:
		return "unknown"
	}
}

func parseCollectorEventStartAt(value string, collectedAt time.Time) *time.Time {
	raw := strings.TrimSpace(value)
	if raw == "" {
		return nil
	}

	layoutsWithDate := []string{
		"01/02/2006 15:04:05",
		"01/02/2006 03:04PM",
		"01/02 03:04PM",
		"01/02 15:04",
		"2006-01-02 15:04:05",
		time.RFC3339,
	}
	for _, layout := range layoutsWithDate {
		if parsed, err := time.ParseInLocation(layout, raw, time.UTC); err == nil {
			if layout == "01/02 03:04PM" || layout == "01/02 15:04" {
				parsed = time.Date(collectedAt.Year(), parsed.Month(), parsed.Day(), parsed.Hour(), parsed.Minute(), 0, 0, time.UTC)
			}
			return &parsed
		}
	}

	layoutsTimeOnly := []string{
		"03:04PM",
		"3:04PM",
		"15:04",
	}
	for _, layout := range layoutsTimeOnly {
		if parsed, err := time.ParseInLocation(layout, raw, time.UTC); err == nil {
			resolved := time.Date(
				collectedAt.Year(),
				collectedAt.Month(),
				collectedAt.Day(),
				parsed.Hour(),
				parsed.Minute(),
				0,
				0,
				time.UTC,
			)
			return &resolved
		}
	}

	return nil
}

func canonicalText(value string) string {
	normalized := strings.ToLower(strings.TrimSpace(norm.NFKD.String(value)))
	normalized = strings.Map(func(r rune) rune {
		if unicode.Is(unicode.Mn, r) {
			return -1
		}
		return r
	}, normalized)
	normalized = strings.Map(func(r rune) rune {
		switch {
		case unicode.IsLetter(r), unicode.IsNumber(r):
			return r
		default:
			return ' '
		}
	}, normalized)
	return strings.Join(strings.Fields(normalized), " ")
}

func slugText(value string) string {
	return strings.ReplaceAll(canonicalText(value), " ", "-")
}
