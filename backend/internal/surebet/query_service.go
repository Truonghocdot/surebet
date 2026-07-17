package surebet

import (
	"context"
	"sync"
	"time"

	"surebet/backend/internal/calculator"
	"surebet/backend/internal/dto"
	"surebet/backend/internal/models"
)

const (
	// In-play odds can disappear in seconds. Telegram alerts must use quotes
	// observed almost simultaneously, otherwise the detector can combine a
	// current leg with a no-longer-offered one.
	detectorQuoteFreshnessWindow = 15 * time.Second
	detectorResultMaxAge         = 1 * time.Second
)

type OddsReader interface {
	ListCurrentDetectorCandidatesBySource(ctx context.Context, minCollectedAt time.Time) ([]models.OddsQuote, error)
}

type QueryService struct {
	reader   OddsReader
	detector calculator.Detector

	mu               sync.Mutex
	generation       uint64
	cachedGeneration uint64
	cachedAt         time.Time
	cached           []dto.SurebetView
	hasCache         bool
	refreshing       chan struct{}
}

func NewQueryService(reader OddsReader, detector calculator.Detector) *QueryService {
	return &QueryService{
		reader:   reader,
		detector: detector,
	}
}

// Trigger invalidates the materialized detector result. Stream ingest calls it
// before notifying clients, so concurrent API requests share one recalculation.
func (s *QueryService) Trigger() {
	s.mu.Lock()
	s.generation++
	s.mu.Unlock()
}

func (s *QueryService) ListCurrentSurebets(ctx context.Context) ([]dto.SurebetView, error) {
	for attempt := 0; ; attempt++ {
		s.mu.Lock()
		targetGeneration := s.generation
		if s.hasCache &&
			s.cachedGeneration == targetGeneration &&
			time.Since(s.cachedAt) < detectorResultMaxAge {
			result := cloneSurebetViews(s.cached)
			s.mu.Unlock()
			return result, nil
		}
		if s.refreshing != nil {
			refreshing := s.refreshing
			s.mu.Unlock()
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-refreshing:
				continue
			}
		}

		refreshing := make(chan struct{})
		s.refreshing = refreshing
		s.mu.Unlock()

		result, err := s.detectCurrentSurebets(ctx)

		s.mu.Lock()
		if err == nil {
			s.cached = cloneSurebetViews(result)
			s.cachedGeneration = targetGeneration
			s.cachedAt = time.Now()
			s.hasCache = true
		}
		currentGeneration := s.generation
		s.refreshing = nil
		close(refreshing)
		s.mu.Unlock()

		if err != nil {
			return nil, err
		}
		if currentGeneration != targetGeneration && attempt < 1 {
			continue
		}
		return cloneSurebetViews(result), nil
	}
}

func (s *QueryService) detectCurrentSurebets(ctx context.Context) ([]dto.SurebetView, error) {
	var (
		quotes []models.OddsQuote
		err    error
	)

	quotes, err = s.reader.ListCurrentDetectorCandidatesBySource(
		ctx,
		time.Now().UTC().Add(-detectorQuoteFreshnessWindow),
	)
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

func cloneSurebetViews(items []dto.SurebetView) []dto.SurebetView {
	result := make([]dto.SurebetView, len(items))
	for i, item := range items {
		result[i] = item
		result[i].Legs = append([]dto.SurebetLegView(nil), item.Legs...)
	}
	return result
}

func mapOpportunity(item models.SurebetOpportunity) dto.SurebetView {
	legs := make([]dto.SurebetLegView, 0, len(item.Legs))
	for _, leg := range item.Legs {
		legs = append(legs, dto.SurebetLegView{
			BookmakerID: leg.BookmakerID,
			LobbyID:     leg.LobbyID,
			FixtureID:   leg.FixtureID,
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
