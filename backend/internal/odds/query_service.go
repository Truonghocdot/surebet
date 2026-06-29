package odds

import (
	"context"

	"surebet/backend/internal/dto"
	"surebet/backend/internal/models"
	"surebet/backend/internal/repository"
)

type QueryService struct {
	repo repository.OddsSnapshotRepository
}

func NewQueryService(repo repository.OddsSnapshotRepository) QueryService {
	return QueryService{repo: repo}
}

func (s QueryService) ListCurrentOdds(ctx context.Context, filter dto.OddsFilter) ([]dto.OddsView, error) {
	items, err := s.repo.ListByFixture(ctx, filter.FixtureID)
	if err != nil {
		return nil, err
	}

	if filter.FixtureID == "" {
		repo, ok := s.repo.(interface {
			ListCurrent(ctx context.Context, bookmakerID, lobbyID, fixtureID string) ([]models.OddsQuote, error)
		})
		if ok {
			items, err = repo.ListCurrent(ctx, filter.BookmakerID, filter.LobbyID, filter.FixtureID)
			if err != nil {
				return nil, err
			}
		}
	}

	result := make([]dto.OddsView, 0, len(items))
	for _, item := range items {
		result = append(result, dto.OddsView{
			BookmakerID:    item.BookmakerID,
			LobbyID:        item.LobbyID,
			FixtureID:      item.FixtureID,
			MarketID:       item.MarketID,
			OutcomeID:      item.OutcomeID,
			Odds:           item.Odds,
			AvailableStake: item.AvailableStake,
			CollectedAt:    item.CollectedAt,
		})
	}

	return result, nil
}
