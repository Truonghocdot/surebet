package surebet

import (
	"context"
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

type confirmationReaderStub struct {
	items []dto.SurebetView
}

func (s confirmationReaderStub) ListCurrentSurebets(context.Context) ([]dto.SurebetView, error) {
	return append([]dto.SurebetView(nil), s.items...), nil
}

type confirmationConfirmerStub struct {
	oddsByBookmaker map[string]float64
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
