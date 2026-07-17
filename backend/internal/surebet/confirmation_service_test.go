package surebet

import (
	"context"
	"sync"
	"testing"
	"time"

	"surebet/backend/internal/calculator"
	"surebet/backend/internal/dto"
)

func TestConfirmationServiceRecomputesWithLiveCollectorOdds(t *testing.T) {
	candidate := confirmationCandidate()
	confirmer := confirmationConfirmerStub{oddsByBookmaker: map[string]float64{
		"8xbet": -0.92,
		"jun88": 0.96,
	}}
	service := NewConfirmationService(
		confirmationReaderStub{items: []dto.SurebetView{candidate}},
		confirmer,
		calculator.NewDetector(),
	)

	confirmed, active, err := service.ConfirmCurrentSurebet(context.Background(), candidate.ID)
	if err != nil {
		t.Fatalf("confirm current surebet: %v", err)
	}
	if !active || confirmed.ID != candidate.ID || len(confirmed.Legs) != 2 {
		t.Fatalf("unexpected confirmed opportunity: active=%t item=%+v", active, confirmed)
	}
	if confirmed.Legs[0].Odds == candidate.Legs[0].Odds &&
		confirmed.Legs[1].Odds == candidate.Legs[1].Odds {
		t.Fatal("expected confirmation to use collector odds instead of cached candidate odds")
	}
}

func TestConfirmationServiceRejectsOpportunityAfterOddsMove(t *testing.T) {
	candidate := confirmationCandidate()
	service := NewConfirmationService(
		confirmationReaderStub{items: []dto.SurebetView{candidate}},
		confirmationConfirmerStub{oddsByBookmaker: map[string]float64{
			"8xbet": 0.80,
			"jun88": 0.90,
		}},
		calculator.NewDetector(),
	)

	_, active, err := service.ConfirmCurrentSurebet(context.Background(), candidate.ID)
	if err != nil {
		t.Fatalf("confirm current surebet: %v", err)
	}
	if active {
		t.Fatal("opportunity must be rejected after collector odds no longer form a surebet")
	}
}

func TestConfirmationServiceBatchDropsUnconfirmedCandidates(t *testing.T) {
	confirmedCandidate := confirmationCandidate()
	rejectedCandidate := confirmationCandidate()
	rejectedCandidate.ID = "opportunity-rejected"
	for index := range rejectedCandidate.Legs {
		rejectedCandidate.Legs[index].OutcomeID += "-rejected"
	}

	service := NewConfirmationService(
		confirmationReaderStub{items: []dto.SurebetView{confirmedCandidate, rejectedCandidate}},
		selectiveConfirmationConfirmer{},
		calculator.NewDetector(),
	)

	items, err := service.ListConfirmedSurebets(context.Background())
	if err != nil {
		t.Fatalf("list confirmed surebets: %v", err)
	}
	if len(items) != 1 || items[0].ID != confirmedCandidate.ID {
		t.Fatalf("expected only live confirmed candidate, got %+v", items)
	}
}

func TestConfirmationServiceCachesOnlyMatchingCandidateOdds(t *testing.T) {
	candidate := confirmationCandidate()
	reader := &mutableConfirmationReader{items: []dto.SurebetView{candidate}}
	confirmer := &countingConfirmationConfirmer{}
	service := NewConfirmationService(reader, confirmer, calculator.NewDetector())

	items, err := service.ListConfirmedSurebets(context.Background())
	if err != nil || len(items) != 1 {
		t.Fatalf("first confirmation: items=%+v err=%v", items, err)
	}
	items, err = service.ListConfirmedSurebets(context.Background())
	if err != nil || len(items) != 1 {
		t.Fatalf("cached confirmation: items=%+v err=%v", items, err)
	}
	if confirmer.Count() != 2 {
		t.Fatalf("expected one two-leg collector confirmation, got %d calls", confirmer.Count())
	}

	reader.mu.Lock()
	reader.items[0].Legs[0].Odds = 0.51
	reader.mu.Unlock()
	items, err = service.ListConfirmedSurebets(context.Background())
	if err != nil || len(items) != 1 {
		t.Fatalf("confirmation after candidate odds change: items=%+v err=%v", items, err)
	}
	if confirmer.Count() != 4 {
		t.Fatalf("candidate odds change must bypass cache, got %d collector calls", confirmer.Count())
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

type selectiveConfirmationConfirmer struct{}

func (selectiveConfirmationConfirmer) ConfirmQuote(
	ctx context.Context,
	source dto.CollectorSource,
	fixtureID, marketID, outcomeID string,
) (dto.CollectorConfirmQuoteResponse, error) {
	if len(outcomeID) >= len("-rejected") && outcomeID[len(outcomeID)-len("-rejected"):] == "-rejected" {
		return dto.CollectorConfirmQuoteResponse{ObservedAt: time.Now().UTC(), Found: false}, nil
	}
	return confirmationConfirmerStub{oddsByBookmaker: map[string]float64{
		"8xbet": -0.92,
		"jun88": 0.96,
	}}.ConfirmQuote(ctx, source, fixtureID, marketID, outcomeID)
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
	return dto.CollectorConfirmQuoteResponse{
		Type:       "confirm_quote_response",
		ObservedAt: now,
		Found:      true,
		Selection: &dto.CollectorConfirmedSelection{
			FixtureID:   fixtureID,
			Sport:       "football",
			HomeTeam:    home,
			AwayTeam:    away,
			LeagueName:  "League",
			MatchState:  "live",
			MarketID:    marketID,
			OutcomeID:   outcomeID,
			OutcomeName: outcomeName,
			Odds:        s.oddsByBookmaker[source.BookmakerID],
		},
	}, nil
}

func confirmationCandidate() dto.SurebetView {
	now := time.Now().UTC()
	return dto.SurebetView{
		ID:         "opportunity-confirm",
		FixtureID:  "team a vs team b",
		MarketName: "Handicap",
		DetectedAt: now,
		ExpiresAt:  now.Add(time.Minute),
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
