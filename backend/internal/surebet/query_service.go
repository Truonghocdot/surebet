package surebet

import (
	"context"
	"time"

	"surebet/backend/internal/calculator"
	"surebet/backend/internal/dto"
	"surebet/backend/internal/models"
)

const detectorQuoteFreshnessWindow = 45 * time.Second

type OddsReader interface {
	ListCurrent(ctx context.Context, bookmakerID, lobbyID, fixtureID string) ([]models.OddsQuote, error)
}

type QueryService struct {
	reader   OddsReader
	detector calculator.Detector
}

func NewQueryService(reader OddsReader, detector calculator.Detector) QueryService {
	return QueryService{
		reader:   reader,
		detector: detector,
	}
}

func (s QueryService) ListCurrentSurebets(ctx context.Context) ([]dto.SurebetView, error) {
	var (
		quotes []models.OddsQuote
		err    error
	)

	if repo, ok := s.reader.(interface {
		ListCurrentDetectorCandidatesBySource(ctx context.Context, minCollectedAt time.Time) ([]models.OddsQuote, error)
	}); ok {
		quotes, err = repo.ListCurrentDetectorCandidatesBySource(ctx, time.Now().UTC().Add(-detectorQuoteFreshnessWindow))
	} else if repo, ok := s.reader.(interface {
		ListCurrentDetectorCandidates(ctx context.Context, minCollectedAt time.Time) ([]models.OddsQuote, error)
	}); ok {
		quotes, err = repo.ListCurrentDetectorCandidates(ctx, time.Now().UTC().Add(-detectorQuoteFreshnessWindow))
	} else {
		quotes, err = s.reader.ListCurrent(ctx, "", "", "")
	}
	if err != nil {
		return nil, err
	}

	opportunities, err := s.detector.Detect(ctx, quotes)
	if err != nil {
		return nil, err
	}

	result := make([]dto.SurebetView, 0, len(opportunities))
	for _, item := range opportunities {
		result = append(result, mapOpportunity(item))
	}

	return result, nil
}

func mapOpportunity(item models.SurebetOpportunity) dto.SurebetView {
	legs := make([]dto.SurebetLegView, 0, len(item.Legs))
	for _, leg := range item.Legs {
		legs = append(legs, dto.SurebetLegView{
			BookmakerID: leg.BookmakerID,
			LobbyID:     leg.LobbyID,
			MarketID:    leg.MarketID,
			OutcomeID:   leg.OutcomeID,
			OutcomeName: leg.OutcomeName,
			Odds:        leg.Odds,
			Stake:       leg.Stake,
		})
	}

	detectedAt := item.DetectedAt
	if detectedAt.IsZero() {
		detectedAt = time.Now().UTC()
	}
	expiresAt := item.ExpiresAt
	if expiresAt.IsZero() {
		expiresAt = detectedAt.Add(30 * time.Second)
	}

	return dto.SurebetView{
		ID:               item.ID,
		FixtureID:        item.FixtureID,
		MarketName:       item.MarketName,
		ProfitPercentage: item.ProfitPercentage,
		ExpectedReturn:   item.ExpectedReturn,
		DetectedAt:       detectedAt,
		ExpiresAt:        expiresAt,
		Legs:             legs,
	}
}
