package odds

import (
	"context"

	"surebet/backend/internal/dto"
	"surebet/backend/internal/models"
)

type OddsReader interface {
	ListByFixture(ctx context.Context, fixtureID string) ([]models.OddsQuote, error)
	ListCurrent(ctx context.Context, bookmakerID, lobbyID, fixtureID string) ([]models.OddsQuote, error)
	ListCurrentLive(ctx context.Context, bookmakerID, lobbyID, fixtureID string) ([]models.OddsQuote, error)
}

type QueryService struct {
	repo OddsReader
}

func NewQueryService(repo OddsReader) QueryService {
	return QueryService{repo: repo}
}

func (s QueryService) ListCurrentOdds(ctx context.Context, filter dto.OddsFilter) ([]dto.OddsView, error) {
	var (
		items []models.OddsQuote
		err   error
	)

	if filter.FixtureID != "" {
		items, err = s.repo.ListByFixture(ctx, filter.FixtureID)
		if err != nil {
			return nil, err
		}
	}

	if filter.FixtureID == "" {
		if !filter.IncludeSuspended {
			items, err = s.repo.ListCurrentLive(ctx, filter.BookmakerID, filter.LobbyID, filter.FixtureID)
			if err != nil {
				return nil, err
			}
		} else {
			items, err = s.repo.ListCurrent(ctx, filter.BookmakerID, filter.LobbyID, filter.FixtureID)
			if err != nil {
				return nil, err
			}
		}
	}

	result := make([]dto.OddsView, 0, len(items))
	for _, item := range items {
		if !filter.IncludeSuspended && (item.Suspended || item.Odds == 0) {
			continue
		}

		normalized := normalizeQuoteView(item)
		result = append(result, dto.OddsView{
			BookmakerID:    item.BookmakerID,
			LobbyID:        item.LobbyID,
			FixtureID:      item.FixtureID,
			FixtureMarker:  item.FixtureMarker,
			LeagueName:     item.LeagueName,
			HomeTeam:       item.HomeTeam,
			AwayTeam:       item.AwayTeam,
			MatchState:     item.MatchState,
			EventStartAt:   item.EventStartAt,
			MatchName:      normalized.MatchName,
			Period:         normalized.Period,
			MarketType:     normalized.MarketType,
			Line:           normalized.Line,
			Side:           normalized.Side,
			MarketID:       item.MarketID,
			OutcomeID:      item.OutcomeID,
			OutcomeName:    item.OutcomeName,
			Odds:           item.Odds,
			DecimalOdds:    normalized.DecimalOdds,
			AvailableStake: item.AvailableStake,
			Suspended:      item.Suspended,
			CollectedAt:    item.CollectedAt,
		})
	}

	return result, nil
}
