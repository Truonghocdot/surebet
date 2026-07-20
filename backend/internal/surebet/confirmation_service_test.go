package surebet

import (
	"context"
	"sync"
	"testing"
	"time"

	"surebet/backend/internal/calculator"
	"surebet/backend/internal/config"
	"surebet/backend/internal/dto"
)

func TestConfirmationServiceHardConfirmsCurrentDetectorResult(t *testing.T) {
	candidate := confirmationCandidate()
	service := NewConfirmationService(
		confirmationReaderStub{items: []dto.SurebetView{candidate}},
		confirmationConfirmerStub{oddsByBookmaker: map[string]float64{"8xbet": -0.92, "jun88": 0.96}},
		calculator.NewDetector(),
	)

	confirmed, active, err := service.ConfirmCurrentSurebet(context.Background(), candidate.ID)
	if err != nil {
		t.Fatalf("confirm current surebet: %v", err)
	}
	if !active || confirmed.ID != candidate.ID || len(confirmed.Legs) != 2 {
		t.Fatalf("unexpected confirmed opportunity: active=%t item=%+v", active, confirmed)
	}
	if confirmed.VerificationStatus != "confirmed" || confirmed.ValidUntil.IsZero() {
		t.Fatal("confirmation must return a short-lived verified opportunity")
	}
}

func TestConfirmationServiceRejectsOpportunityMissingFromCurrentDetectorResult(t *testing.T) {
	candidate := confirmationCandidate()
	service := NewConfirmationService(
		confirmationReaderStub{items: nil},
		confirmationConfirmerStub{},
		calculator.NewDetector(),
	)

	_, active, err := service.ConfirmCurrentSurebet(context.Background(), candidate.ID)
	if err != nil {
		t.Fatalf("confirm current surebet: %v", err)
	}
	if active {
		t.Fatal("opportunity missing from the current detector result must be rejected")
	}
}

func TestConfirmationServiceRejectsExpiredCurrentOpportunity(t *testing.T) {
	candidate := confirmationCandidate()
	candidate.ExpiresAt = time.Now().UTC().Add(-time.Second)
	service := NewConfirmationService(
		confirmationReaderStub{items: []dto.SurebetView{candidate}},
		confirmationConfirmerStub{},
		calculator.NewDetector(),
	)

	_, active, err := service.ConfirmCurrentSurebet(context.Background(), candidate.ID)
	if err != nil {
		t.Fatalf("confirm current surebet: %v", err)
	}
	if active {
		t.Fatal("expired opportunity must be rejected")
	}
}

func TestConfirmationServiceListsVerifiedRegistryWithoutCollectorCalls(t *testing.T) {
	confirmedCandidate := confirmationCandidate()
	confirmedCandidate.VerificationStatus = "confirmed"
	confirmer := &countingConfirmationConfirmer{}
	service := NewConfirmationService(
		confirmationReaderStub{items: []dto.SurebetView{confirmationCandidate()}},
		confirmer,
		calculator.NewDetector(),
		&confirmationVerifiedStoreStub{items: []dto.SurebetView{confirmedCandidate}},
	)

	items, err := service.ListConfirmedSurebets(context.Background())
	if err != nil {
		t.Fatalf("list confirmed surebets: %v", err)
	}
	if len(items) != 1 || items[0].ID != confirmedCandidate.ID || confirmer.Count() != 0 {
		t.Fatalf("expected a registry-only read, got items=%+v collector_calls=%d", items, confirmer.Count())
	}
}

func TestConfirmationServiceDoesNotCacheCompletedConfirmation(t *testing.T) {
	candidate := confirmationCandidate()
	reader := &mutableConfirmationReader{items: []dto.SurebetView{candidate}}
	confirmer := &countingConfirmationConfirmer{}
	service := NewConfirmationService(reader, confirmer, calculator.NewDetector())

	_, confirmed, err := service.ConfirmCurrentSurebet(context.Background(), candidate.ID)
	if err != nil || !confirmed {
		t.Fatalf("first confirmation: confirmed=%t err=%v", confirmed, err)
	}
	_, confirmed, err = service.ConfirmCurrentSurebet(context.Background(), candidate.ID)
	if err != nil || !confirmed {
		t.Fatalf("second confirmation: confirmed=%t err=%v", confirmed, err)
	}
	if confirmer.Count() != 4 {
		t.Fatalf("expected every completed confirmation to recheck both legs, got %d calls", confirmer.Count())
	}

	reader.mu.Lock()
	reader.items[0].Legs[0].Odds = 0.51
	reader.mu.Unlock()
	_, confirmed, err = service.ConfirmCurrentSurebet(context.Background(), candidate.ID)
	if err != nil || !confirmed {
		t.Fatalf("confirmation after candidate odds change: confirmed=%t err=%v", confirmed, err)
	}
	if confirmer.Count() != 6 {
		t.Fatalf("candidate odds change must perform another two-leg confirmation, got %d collector calls", confirmer.Count())
	}
}

func TestConfirmationServiceRejectsAmbiguousFixtureBeforeCollectorCalls(t *testing.T) {
	candidate := confirmationCandidate()
	candidate.MatchAmbiguous = true
	confirmer := &countingConfirmationConfirmer{}
	service := NewConfirmationService(
		confirmationReaderStub{items: []dto.SurebetView{candidate}},
		confirmer,
		calculator.NewDetector(),
	)
	if _, confirmed, err := service.ConfirmCurrentSurebet(context.Background(), candidate.ID); err != nil || confirmed {
		t.Fatalf("ambiguous fixture must be rejected: confirmed=%t err=%v", confirmed, err)
	}
	if confirmer.Count() != 0 {
		t.Fatalf("ambiguous fixture must not call collectors, got %d calls", confirmer.Count())
	}
}

func TestConfirmationServiceRejectsCollectorObservationSkew(t *testing.T) {
	candidate := confirmationCandidate()
	service := NewConfirmationService(
		confirmationReaderStub{items: []dto.SurebetView{candidate}},
		skewedConfirmationConfirmer{},
		calculator.NewDetector(),
	)
	if _, confirmed, err := service.ConfirmCurrentSurebet(context.Background(), candidate.ID); err != nil || confirmed {
		t.Fatalf("skewed observations must be rejected: confirmed=%t err=%v", confirmed, err)
	}
}

func TestConfirmationServiceRejectsOddsThatNoLongerArbitrage(t *testing.T) {
	candidate := confirmationCandidate()
	service := NewConfirmationService(
		confirmationReaderStub{items: []dto.SurebetView{candidate}},
		confirmationConfirmerStub{oddsByBookmaker: map[string]float64{"8xbet": 0.50, "jun88": 0.50}},
		calculator.NewDetector(),
	)
	if _, confirmed, err := service.ConfirmCurrentSurebet(context.Background(), candidate.ID); err != nil || confirmed {
		t.Fatalf("non-arbitrage confirmed odds must be rejected: confirmed=%t err=%v", confirmed, err)
	}
}

func TestConfirmationServiceRejectsMissingLeg(t *testing.T) {
	candidate := confirmationCandidate()
	service := NewConfirmationService(
		confirmationReaderStub{items: []dto.SurebetView{candidate}},
		missingLegConfirmationConfirmer{},
		calculator.NewDetector(),
	)
	if _, confirmed, err := service.ConfirmCurrentSurebet(context.Background(), candidate.ID); err != nil || confirmed {
		t.Fatalf("missing confirmed leg must be rejected: confirmed=%t err=%v", confirmed, err)
	}
}

func TestConfirmationServiceTimesOutTheWholeConfirmation(t *testing.T) {
	candidate := confirmationCandidate()
	service := NewConfirmationServiceWithConfig(
		confirmationReaderStub{items: []dto.SurebetView{candidate}},
		blockingConfirmationConfirmer{},
		calculator.NewDetector(),
		config.TelegramConfig{ConfirmationTimeout: 10 * time.Millisecond},
	)
	if _, confirmed, err := service.ConfirmCurrentSurebet(context.Background(), candidate.ID); err == nil || confirmed {
		t.Fatalf("timed out confirmation must fail: confirmed=%t err=%v", confirmed, err)
	}
}

func TestConfirmationServiceRejectsUnknownEightXBetOddsFormat(t *testing.T) {
	candidate := confirmationCandidate()
	service := NewConfirmationService(
		confirmationReaderStub{items: []dto.SurebetView{candidate}},
		invalidOddsFormatConfirmer{},
		calculator.NewDetector(),
	)
	if _, confirmed, err := service.ConfirmCurrentSurebet(context.Background(), candidate.ID); err == nil || confirmed {
		t.Fatalf("unknown odds format must return a parser error: confirmed=%t err=%v", confirmed, err)
	}
}

type confirmationReaderStub struct {
	items []dto.SurebetView
}

func (s confirmationReaderStub) ListCurrentSurebets(context.Context) ([]dto.SurebetView, error) {
	return append([]dto.SurebetView(nil), s.items...), nil
}

type confirmationConfirmerStub struct {
	oddsByBookmaker map[string]float64
}

type skewedConfirmationConfirmer struct{}

type invalidOddsFormatConfirmer struct{}

type missingLegConfirmationConfirmer struct{}

func (missingLegConfirmationConfirmer) ConfirmQuote(
	ctx context.Context,
	source dto.CollectorSource,
	fixtureID, marketID, outcomeID string,
) (dto.CollectorConfirmQuoteResponse, error) {
	if source.BookmakerID == "jun88" {
		return dto.CollectorConfirmQuoteResponse{ObservedAt: time.Now().UTC(), Found: false}, nil
	}
	return confirmationConfirmerStub{oddsByBookmaker: map[string]float64{"8xbet": -0.92}}.
		ConfirmQuote(ctx, source, fixtureID, marketID, outcomeID)
}

type blockingConfirmationConfirmer struct{}

func (blockingConfirmationConfirmer) ConfirmQuote(
	ctx context.Context,
	_ dto.CollectorSource,
	_, _, _ string,
) (dto.CollectorConfirmQuoteResponse, error) {
	<-ctx.Done()
	return dto.CollectorConfirmQuoteResponse{}, ctx.Err()
}

func (invalidOddsFormatConfirmer) ConfirmQuote(
	ctx context.Context,
	source dto.CollectorSource,
	fixtureID, marketID, outcomeID string,
) (dto.CollectorConfirmQuoteResponse, error) {
	response, err := confirmationConfirmerStub{oddsByBookmaker: map[string]float64{
		"8xbet": -0.92,
		"jun88": 0.96,
	}}.ConfirmQuote(ctx, source, fixtureID, marketID, outcomeID)
	if source.BookmakerID == "8xbet" {
		response.Selection.OddsFormat = ""
	}
	return response, err
}

func (skewedConfirmationConfirmer) ConfirmQuote(
	ctx context.Context,
	source dto.CollectorSource,
	fixtureID, marketID, outcomeID string,
) (dto.CollectorConfirmQuoteResponse, error) {
	response, err := confirmationConfirmerStub{oddsByBookmaker: map[string]float64{
		"8xbet": -0.92,
		"jun88": 0.96,
	}}.ConfirmQuote(ctx, source, fixtureID, marketID, outcomeID)
	if source.BookmakerID == "8xbet" {
		response.ObservedAt = response.ObservedAt.Add(-1500 * time.Millisecond)
	}
	return response, err
}

type mutableConfirmationReader struct {
	mu    sync.Mutex
	items []dto.SurebetView
}

func (r *mutableConfirmationReader) ListCurrentSurebets(context.Context) ([]dto.SurebetView, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	items := make([]dto.SurebetView, len(r.items))
	for index, item := range r.items {
		items[index] = cloneSurebetView(item)
	}
	return items, nil
}

type countingConfirmationConfirmer struct {
	mu    sync.Mutex
	calls int
}

func (c *countingConfirmationConfirmer) ConfirmQuote(
	ctx context.Context,
	source dto.CollectorSource,
	fixtureID, marketID, outcomeID string,
) (dto.CollectorConfirmQuoteResponse, error) {
	c.mu.Lock()
	c.calls++
	c.mu.Unlock()
	return confirmationConfirmerStub{oddsByBookmaker: map[string]float64{
		"8xbet": -0.92,
		"jun88": 0.96,
	}}.ConfirmQuote(ctx, source, fixtureID, marketID, outcomeID)
}

func (c *countingConfirmationConfirmer) Count() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.calls
}

type confirmationVerifiedStoreStub struct {
	items []dto.SurebetView
}

func (s *confirmationVerifiedStoreStub) Put(_ context.Context, item dto.SurebetView, _ time.Duration) error {
	s.items = append(s.items, item)
	return nil
}

func (s *confirmationVerifiedStoreStub) Get(_ context.Context, id string) (dto.SurebetView, bool, error) {
	for _, item := range s.items {
		if item.ID == id {
			return item, true, nil
		}
	}
	return dto.SurebetView{}, false, nil
}

func (s *confirmationVerifiedStoreStub) List(context.Context) ([]dto.SurebetView, error) {
	return append([]dto.SurebetView(nil), s.items...), nil
}

func (s confirmationConfirmerStub) ConfirmQuote(
	_ context.Context,
	source dto.CollectorSource,
	fixtureID, marketID, outcomeID string,
) (dto.CollectorConfirmQuoteResponse, error) {
	now := time.Now().UTC()
	home := "Team A"
	away := "Team B"
	outcomeName := "Team A +0.5"
	if source.BookmakerID == "jun88" {
		outcomeName = "Team B -0.5"
	}
	odds := s.oddsByBookmaker[source.BookmakerID]
	if odds == 0 {
		odds = -0.92
	}
	rawOdds := odds
	oddsFormat := "malay"
	if source.BookmakerID == "8xbet" {
		oddsFormat = "indonesian"
		if odds < 0 {
			rawOdds = 1 / -odds
		}
	}
	return dto.CollectorConfirmQuoteResponse{
		Type:       "confirm_quote_response",
		ObservedAt: now,
		Found:      true,
		Selection: &dto.CollectorConfirmedSelection{
			FixtureID:     fixtureID,
			Sport:         "football",
			HomeTeam:      home,
			AwayTeam:      away,
			LeagueName:    "League",
			MatchState:    "live",
			MarketID:      marketID,
			OutcomeID:     outcomeID,
			OutcomeName:   outcomeName,
			Odds:          odds,
			RawOdds:       rawOdds,
			OddsFormat:    oddsFormat,
			SourceEventID: source.BookmakerID + "-event",
		},
	}, nil
}

func confirmationCandidate() dto.SurebetView {
	now := time.Now().UTC()
	return dto.SurebetView{
		ID:              "opportunity-confirm",
		FixtureID:       "team a vs team b",
		MarketName:      "Handicap",
		DetectedAt:      now,
		ExpiresAt:       now.Add(time.Minute),
		MatchConfidence: 1,
		Legs: []dto.SurebetLegView{
			{
				BookmakerID: "8xbet",
				LobbyID:     "default",
				FixtureID:   "fixture-8xbet",
				MarketID:    "hdp-ah",
				OutcomeID:   "home-plus-0.5",
				OutcomeName: "Team A +0.5",
				Odds:        0.50,
			},
			{
				BookmakerID: "jun88",
				LobbyID:     "cmd",
				FixtureID:   "fixture-cmd",
				MarketID:    "hdp-ah",
				OutcomeID:   "away-minus-0.5",
				OutcomeName: "Team B -0.5",
				Odds:        0.50,
			},
		},
	}
}
