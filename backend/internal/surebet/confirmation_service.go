package surebet

import (
	"context"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"surebet/backend/internal/calculator"
	"surebet/backend/internal/dto"
	"surebet/backend/internal/models"
)

const (
	confirmationTimeout          = 2500 * time.Millisecond
	confirmationMaxAge           = 3 * time.Second
	confirmationCacheTTL         = 2 * time.Second
	confirmationBatchTimeout     = 5 * time.Second
	confirmationBatchConcurrency = 2
)

type CollectorQuoteConfirmer interface {
	ConfirmQuote(
		ctx context.Context,
		source dto.CollectorSource,
		fixtureID, marketID, outcomeID string,
	) (dto.CollectorConfirmQuoteResponse, error)
}

type CurrentSurebetReader interface {
	ListCurrentSurebets(ctx context.Context) ([]dto.SurebetView, error)
}

type ConfirmationService struct {
	current   CurrentSurebetReader
	confirmer CollectorQuoteConfirmer
	detector  calculator.Detector

	mu       sync.Mutex
	cache    map[string]confirmationCacheEntry
	inflight map[string]*confirmationCall
}

type confirmationCacheEntry struct {
	item      dto.SurebetView
	confirmed bool
	expiresAt time.Time
}

type confirmationCall struct {
	done      chan struct{}
	item      dto.SurebetView
	confirmed bool
	err       error
}

func NewConfirmationService(
	current CurrentSurebetReader,
	confirmer CollectorQuoteConfirmer,
	detector calculator.Detector,
) *ConfirmationService {
	return &ConfirmationService{
		current:   current,
		confirmer: confirmer,
		detector:  detector,
		cache:     make(map[string]confirmationCacheEntry),
		inflight:  make(map[string]*confirmationCall),
	}
}

func (s *ConfirmationService) ConfirmCurrentSurebet(
	ctx context.Context,
	opportunityID string,
) (dto.SurebetView, bool, error) {
	if s == nil || s.current == nil || s.confirmer == nil || s.detector == nil {
		return dto.SurebetView{}, false, fmt.Errorf("surebet confirmation is not configured")
	}

	items, err := s.current.ListCurrentSurebets(ctx)
	if err != nil {
		return dto.SurebetView{}, false, err
	}
	var current dto.SurebetView
	found := false
	for _, item := range items {
		if item.ID == opportunityID {
			current = item
			found = true
			break
		}
	}
	if !found || len(current.Legs) != 2 {
		return dto.SurebetView{}, false, nil
	}
	return s.confirmCandidateUncached(ctx, current)
}

func (s *ConfirmationService) ListConfirmedSurebets(ctx context.Context) ([]dto.SurebetView, error) {
	if s == nil || s.current == nil || s.confirmer == nil || s.detector == nil {
		return nil, fmt.Errorf("surebet confirmation is not configured")
	}

	candidates, err := s.current.ListCurrentSurebets(ctx)
	if err != nil {
		return nil, err
	}
	if len(candidates) == 0 {
		return []dto.SurebetView{}, nil
	}

	batchCtx, cancel := context.WithTimeout(ctx, confirmationBatchTimeout)
	defer cancel()
	type indexedResult struct {
		index     int
		item      dto.SurebetView
		confirmed bool
	}
	results := make(chan indexedResult, len(candidates))
	semaphore := make(chan struct{}, confirmationBatchConcurrency)

	for index, candidate := range candidates {
		go func(index int, candidate dto.SurebetView) {
			select {
			case semaphore <- struct{}{}:
				defer func() { <-semaphore }()
			case <-batchCtx.Done():
				results <- indexedResult{index: index}
				return
			}

			item, confirmed, confirmErr := s.confirmCandidate(batchCtx, candidate)
			results <- indexedResult{
				index:     index,
				item:      item,
				confirmed: confirmErr == nil && confirmed,
			}
		}(index, candidate)
	}

	confirmedByIndex := make(map[int]dto.SurebetView, len(candidates))
	for range candidates {
		select {
		case result := <-results:
			if result.confirmed {
				confirmedByIndex[result.index] = result.item
			}
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}

	confirmed := make([]dto.SurebetView, 0, len(confirmedByIndex))
	for index := range candidates {
		if item, ok := confirmedByIndex[index]; ok {
			confirmed = append(confirmed, item)
		}
	}
	return confirmed, nil
}

func (s *ConfirmationService) confirmCandidate(
	ctx context.Context,
	current dto.SurebetView,
) (dto.SurebetView, bool, error) {
	if len(current.Legs) != 2 {
		return dto.SurebetView{}, false, nil
	}

	cacheKey := confirmationCandidateKey(current)
	now := time.Now().UTC()
	s.mu.Lock()
	if cached, ok := s.cache[cacheKey]; ok && now.Before(cached.expiresAt) {
		item := cloneSurebetView(cached.item)
		s.mu.Unlock()
		return item, cached.confirmed, nil
	}
	if call := s.inflight[cacheKey]; call != nil {
		s.mu.Unlock()
		select {
		case <-ctx.Done():
			return dto.SurebetView{}, false, ctx.Err()
		case <-call.done:
			return cloneSurebetView(call.item), call.confirmed, call.err
		}
	}

	call := &confirmationCall{done: make(chan struct{})}
	s.inflight[cacheKey] = call
	s.mu.Unlock()

	item, confirmed, err := s.confirmCandidateUncached(ctx, current)

	s.mu.Lock()
	call.item = cloneSurebetView(item)
	call.confirmed = confirmed
	call.err = err
	if err == nil {
		s.cache[cacheKey] = confirmationCacheEntry{
			item:      cloneSurebetView(item),
			confirmed: confirmed,
			expiresAt: time.Now().UTC().Add(confirmationCacheTTL),
		}
	}
	delete(s.inflight, cacheKey)
	close(call.done)
	s.pruneConfirmationCacheLocked(now)
	s.mu.Unlock()

	return item, confirmed, err
}

func (s *ConfirmationService) confirmCandidateUncached(
	ctx context.Context,
	current dto.SurebetView,
) (dto.SurebetView, bool, error) {
	confirmCtx, cancel := context.WithTimeout(ctx, confirmationTimeout)
	defer cancel()

	type confirmationResult struct {
		index    int
		response dto.CollectorConfirmQuoteResponse
		err      error
	}
	results := make(chan confirmationResult, len(current.Legs))
	for index, leg := range current.Legs {
		go func(index int, leg dto.SurebetLegView) {
			response, err := s.confirmer.ConfirmQuote(
				confirmCtx,
				collectorSourceForLeg(leg),
				leg.FixtureID,
				leg.MarketID,
				leg.OutcomeID,
			)
			results <- confirmationResult{index: index, response: response, err: err}
		}(index, leg)
	}

	confirmed := make([]dto.CollectorConfirmQuoteResponse, len(current.Legs))
	for range current.Legs {
		select {
		case <-confirmCtx.Done():
			return dto.SurebetView{}, false, confirmCtx.Err()
		case result := <-results:
			if result.err != nil {
				return dto.SurebetView{}, false, result.err
			}
			confirmed[result.index] = result.response
		}
	}

	now := time.Now().UTC()
	quotes := make([]models.OddsQuote, 0, len(confirmed))
	for index, response := range confirmed {
		quote, ok := confirmedQuoteToModel(current.Legs[index], response, now)
		if !ok {
			return dto.SurebetView{}, false, nil
		}
		quotes = append(quotes, quote)
	}

	opportunities, err := s.detector.Detect(ctx, quotes)
	if err != nil {
		return dto.SurebetView{}, false, err
	}
	if len(opportunities) == 0 {
		return dto.SurebetView{}, false, nil
	}

	result := mapOpportunity(opportunities[0])
	result.ID = current.ID
	result.FixtureID = current.FixtureID
	result.MarketName = current.MarketName
	return result, true, nil
}

func (s *ConfirmationService) pruneConfirmationCacheLocked(now time.Time) {
	for key, cached := range s.cache {
		if !now.Before(cached.expiresAt) {
			delete(s.cache, key)
		}
	}
}

func confirmationCandidateKey(item dto.SurebetView) string {
	legs := make([]string, 0, len(item.Legs))
	for _, leg := range item.Legs {
		legs = append(legs, strings.Join([]string{
			leg.BookmakerID,
			leg.LobbyID,
			leg.FixtureID,
			leg.MarketID,
			leg.OutcomeID,
			strconv.FormatFloat(leg.Odds, 'g', -1, 64),
		}, "\x00"))
	}
	sort.Strings(legs)
	return item.ID + "\x00" + strings.Join(legs, "\x01")
}

func cloneSurebetView(item dto.SurebetView) dto.SurebetView {
	item.Legs = append([]dto.SurebetLegView(nil), item.Legs...)
	return item
}

func collectorSourceForLeg(leg dto.SurebetLegView) dto.CollectorSource {
	collectorID := leg.BookmakerID
	if leg.BookmakerID == "jun88" && leg.LobbyID == "cmd" {
		collectorID = "jun88-cmd"
	}
	return dto.CollectorSource{
		CollectorID: collectorID,
		BookmakerID: leg.BookmakerID,
		LobbyID:     leg.LobbyID,
	}
}

func confirmedQuoteToModel(
	leg dto.SurebetLegView,
	response dto.CollectorConfirmQuoteResponse,
	now time.Time,
) (models.OddsQuote, bool) {
	selection := response.Selection
	if !response.Found || selection == nil || selection.Suspended {
		return models.OddsQuote{}, false
	}
	if selection.FixtureID != leg.FixtureID ||
		selection.MarketID != leg.MarketID ||
		selection.OutcomeID != leg.OutcomeID {
		return models.OddsQuote{}, false
	}
	if response.ObservedAt.IsZero() {
		return models.OddsQuote{}, false
	}
	age := now.Sub(response.ObservedAt.UTC())
	if age < -time.Second || age > confirmationMaxAge {
		return models.OddsQuote{}, false
	}

	var eventStartAt *time.Time
	if parsed, err := time.Parse(time.RFC3339, strings.TrimSpace(selection.EventStartAt)); err == nil {
		parsed = parsed.UTC()
		eventStartAt = &parsed
	}

	return models.OddsQuote{
		ID:             leg.BookmakerID + "|" + leg.LobbyID + "|" + selection.OutcomeID,
		BookmakerID:    leg.BookmakerID,
		LobbyID:        leg.LobbyID,
		FixtureID:      selection.FixtureID,
		HomeTeam:       selection.HomeTeam,
		AwayTeam:       selection.AwayTeam,
		LeagueName:     selection.LeagueName,
		Sport:          selection.Sport,
		MarketID:       selection.MarketID,
		MarketName:     selection.MarketID,
		OutcomeID:      selection.OutcomeID,
		OutcomeName:    selection.OutcomeName,
		Odds:           selection.Odds,
		AvailableStake: selection.AvailableStake,
		Suspended:      selection.Suspended,
		MatchState:     selection.MatchState,
		EventStartAt:   eventStartAt,
		CollectedAt:    response.ObservedAt.UTC(),
		LastObservedAt: response.ObservedAt.UTC(),
		ChangedAt:      response.ObservedAt.UTC(),
	}, true
}
