package surebet

import (
	"context"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"surebet/backend/internal/calculator"
	"surebet/backend/internal/config"
	"surebet/backend/internal/dto"
	"surebet/backend/internal/models"
)

const (
	confirmationTimeout     = 2 * time.Second
	confirmationMaxAge      = 2 * time.Second
	confirmationMaxSkew     = time.Second
	confirmationValidityTTL = 2 * time.Second
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

type VerifiedOpportunityStore interface {
	Put(ctx context.Context, item dto.SurebetView, ttl time.Duration) error
	Get(ctx context.Context, opportunityID string) (dto.SurebetView, bool, error)
	List(ctx context.Context) ([]dto.SurebetView, error)
}

type ConfirmationService struct {
	current   CurrentSurebetReader
	confirmer CollectorQuoteConfirmer
	detector  calculator.Detector
	verified  VerifiedOpportunityStore
	timeout   time.Duration
	maxAge    time.Duration
	maxSkew   time.Duration
	validity  time.Duration

	mu       sync.Mutex
	inflight map[string]*confirmationCall
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
	verified ...VerifiedOpportunityStore,
) *ConfirmationService {
	return newConfirmationService(
		current, confirmer, detector, confirmationTimeout, confirmationMaxAge,
		confirmationMaxSkew, confirmationValidityTTL, verified...,
	)
}

func NewConfirmationServiceWithConfig(
	current CurrentSurebetReader,
	confirmer CollectorQuoteConfirmer,
	detector calculator.Detector,
	cfg config.TelegramConfig,
	verified ...VerifiedOpportunityStore,
) *ConfirmationService {
	timeout := positiveDuration(cfg.ConfirmationTimeout, confirmationTimeout)
	validity := positiveDuration(cfg.ConfirmationValidity, confirmationValidityTTL)
	return newConfirmationService(
		current, confirmer, detector, timeout, timeout,
		positiveDuration(cfg.ConfirmationMaxSkew, confirmationMaxSkew), validity, verified...,
	)
}

func newConfirmationService(
	current CurrentSurebetReader,
	confirmer CollectorQuoteConfirmer,
	detector calculator.Detector,
	timeout, maxAge, maxSkew, validity time.Duration,
	verified ...VerifiedOpportunityStore,
) *ConfirmationService {
	var verifiedStore VerifiedOpportunityStore
	if len(verified) > 0 {
		verifiedStore = verified[0]
	}
	return &ConfirmationService{
		current:   current,
		confirmer: confirmer,
		detector:  detector,
		verified:  verifiedStore,
		timeout:   timeout,
		maxAge:    maxAge,
		maxSkew:   maxSkew,
		validity:  validity,
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
	if !found || len(current.Legs) != 2 || current.MatchAmbiguous ||
		(!current.ExpiresAt.IsZero() && !current.ExpiresAt.After(time.Now().UTC())) {
		return dto.SurebetView{}, false, nil
	}

	confirmedItem, confirmed, err := s.confirmCandidate(ctx, current)
	if err != nil || !confirmed {
		return confirmedItem, confirmed, err
	}
	if s.verified != nil {
		if err := s.verified.Put(ctx, confirmedItem, s.validity); err != nil {
			return dto.SurebetView{}, false, err
		}
	}
	return confirmedItem, true, nil
}

func (s *ConfirmationService) ListConfirmedSurebets(ctx context.Context) ([]dto.SurebetView, error) {
	if s == nil || s.verified == nil {
		return nil, fmt.Errorf("verified surebet store is not configured")
	}
	return s.verified.List(ctx)
}

func (s *ConfirmationService) GetVerifiedSurebet(
	ctx context.Context,
	opportunityID string,
) (dto.SurebetView, bool, error) {
	if s == nil || s.verified == nil {
		return dto.SurebetView{}, false, fmt.Errorf("verified surebet store is not configured")
	}
	return s.verified.Get(ctx, opportunityID)
}

func (s *ConfirmationService) confirmCandidate(
	ctx context.Context,
	current dto.SurebetView,
) (dto.SurebetView, bool, error) {
	if len(current.Legs) != 2 {
		return dto.SurebetView{}, false, nil
	}

	cacheKey := confirmationCandidateKey(current)
	s.mu.Lock()
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
	delete(s.inflight, cacheKey)
	close(call.done)
	s.mu.Unlock()

	return item, confirmed, err
}

func (s *ConfirmationService) confirmCandidateUncached(
	ctx context.Context,
	current dto.SurebetView,
) (dto.SurebetView, bool, error) {
	startedAt := time.Now()
	confirmCtx, cancel := context.WithTimeout(ctx, s.timeout)
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
	if confirmationResponseSkew(confirmed) > s.maxSkew {
		return dto.SurebetView{}, false, nil
	}

	now := time.Now().UTC()
	quotes := make([]models.OddsQuote, 0, len(confirmed))
	for index, response := range confirmed {
		quote, ok, convertErr := confirmedQuoteToModel(current.Legs[index], response, now, s.maxAge)
		if convertErr != nil {
			return dto.SurebetView{}, false, convertErr
		}
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
	result.VerificationStatus = "confirmed"
	result.ConfirmedAt = now
	result.ValidUntil = now.Add(s.validity)
	result.ExpiresAt = result.ValidUntil
	result.ConfirmationLatencyMS = time.Since(startedAt).Milliseconds()
	result.MatchConfidence = current.MatchConfidence
	result.MatchAmbiguous = false
	observedByLeg := make(map[string]time.Time, len(current.Legs))
	for index, leg := range current.Legs {
		observedByLeg[confirmationLegIdentity(leg)] = confirmed[index].ObservedAt.UTC()
	}
	for index := range result.Legs {
		if observedAt, ok := observedByLeg[confirmationLegIdentity(result.Legs[index])]; ok {
			result.Legs[index].ObservedAt = observedAt
		}
	}
	return result, true, nil
}

func confirmationLegIdentity(leg dto.SurebetLegView) string {
	return strings.Join([]string{
		leg.BookmakerID, leg.LobbyID, leg.FixtureID, leg.MarketID, leg.OutcomeID,
	}, "\x00")
}

func confirmationResponseSkew(items []dto.CollectorConfirmQuoteResponse) time.Duration {
	if len(items) < 2 {
		return 0
	}
	minObserved := items[0].ObservedAt.UTC()
	maxObserved := minObserved
	for _, item := range items[1:] {
		observed := item.ObservedAt.UTC()
		if observed.Before(minObserved) {
			minObserved = observed
		}
		if observed.After(maxObserved) {
			maxObserved = observed
		}
	}
	return maxObserved.Sub(minObserved)
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
	maxAge time.Duration,
) (models.OddsQuote, bool, error) {
	selection := response.Selection
	if !response.Found || selection == nil || selection.Suspended {
		return models.OddsQuote{}, false, nil
	}
	if selection.FixtureID != leg.FixtureID ||
		selection.MarketID != leg.MarketID ||
		selection.OutcomeID != leg.OutcomeID {
		return models.OddsQuote{}, false, nil
	}
	if response.ObservedAt.IsZero() {
		return models.OddsQuote{}, false, nil
	}
	if !confirmedSelectionOddsValid(leg.BookmakerID, *selection) {
		return models.OddsQuote{}, false, fmt.Errorf(
			"%s collector odds format or provenance is invalid",
			leg.BookmakerID,
		)
	}
	age := now.Sub(response.ObservedAt.UTC())
	if age < -time.Second || age > maxAge {
		return models.OddsQuote{}, false, nil
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
	}, true, nil
}

func positiveDuration(value, fallback time.Duration) time.Duration {
	if value <= 0 {
		return fallback
	}
	return value
}

func confirmedSelectionOddsValid(bookmakerID string, selection dto.CollectorConfirmedSelection) bool {
	switch bookmakerID {
	case "8xbet":
		if selection.OddsFormat != "indonesian" || selection.RawOdds <= 0 || selection.SourceEventID == "" {
			return false
		}
		expected := selection.RawOdds
		if expected > 1 {
			expected = -1 / expected
		}
		expected = math.Round(expected*100) / 100
		return math.Abs(expected-selection.Odds) <= 0.001
	case "jun88":
		return selection.OddsFormat == "malay" && selection.SourceEventID != ""
	default:
		return false
	}
}
