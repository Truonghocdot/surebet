package calculator

import (
	"context"
	"testing"
	"time"

	"surebet/backend/internal/models"
)

func TestDetectOverUnderSurebet(t *testing.T) {
	detector := NewDetector()
	now := time.Now().UTC()

	quotes := []models.OddsQuote{
		{
			ID:          "a1",
			BookmakerID: "book-a",
			LobbyID:     "bti",
			FixtureID:   "fixture-1",
			MarketID:    "ta-i-xi-u",
			MarketName:  "Tài/Xỉu",
			OutcomeID:   "over",
			OutcomeName: "Over 2.5",
			Odds:        2.1,
			CollectedAt: now,
		},
		{
			ID:          "b1",
			BookmakerID: "book-b",
			LobbyID:     "cmd",
			FixtureID:   "fixture-1",
			MarketID:    "ta-i-xi-u",
			MarketName:  "Tài/Xỉu",
			OutcomeID:   "under",
			OutcomeName: "Under 2.5",
			Odds:        2.05,
			CollectedAt: now,
		},
	}

	items, err := detector.Detect(context.Background(), quotes)
	if err != nil {
		t.Fatalf("detect returned error: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected 1 surebet, got %d", len(items))
	}
	if items[0].ProfitPercentage <= 0 {
		t.Fatalf("expected positive profit, got %f", items[0].ProfitPercentage)
	}
	if len(items[0].Legs) != 2 {
		t.Fatalf("expected 2 legs, got %d", len(items[0].Legs))
	}
}

func TestDetectHandicapSurebet(t *testing.T) {
	detector := NewDetector()
	now := time.Now().UTC()

	quotes := []models.OddsQuote{
		{
			ID:          "a2",
			BookmakerID: "book-a",
			LobbyID:     "ibc",
			FixtureID:   "fixture-2",
			MarketID:    "cu-o-c-cha-p",
			MarketName:  "Cược chấp",
			OutcomeID:   "home",
			OutcomeName: "Home -0.5",
			Odds:        2.12,
			CollectedAt: now,
		},
		{
			ID:          "b2",
			BookmakerID: "book-b",
			LobbyID:     "m8",
			FixtureID:   "fixture-2",
			MarketID:    "cu-o-c-cha-p",
			MarketName:  "Cược chấp",
			OutcomeID:   "away",
			OutcomeName: "Away +0.5",
			Odds:        2.02,
			CollectedAt: now,
		},
	}

	items, err := detector.Detect(context.Background(), quotes)
	if err != nil {
		t.Fatalf("detect returned error: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected 1 surebet, got %d", len(items))
	}
}

func TestDetectIgnoresNonSurebet(t *testing.T) {
	detector := NewDetector()
	now := time.Now().UTC()

	quotes := []models.OddsQuote{
		{
			ID:          "a3",
			BookmakerID: "book-a",
			LobbyID:     "bti",
			FixtureID:   "fixture-3",
			MarketID:    "ta-i-xi-u",
			MarketName:  "Tài/Xỉu",
			OutcomeID:   "over",
			OutcomeName: "Over 2.5",
			Odds:        1.8,
			CollectedAt: now,
		},
		{
			ID:          "b3",
			BookmakerID: "book-b",
			LobbyID:     "cmd",
			FixtureID:   "fixture-3",
			MarketID:    "ta-i-xi-u",
			MarketName:  "Tài/Xỉu",
			OutcomeID:   "under",
			OutcomeName: "Under 2.5",
			Odds:        1.9,
			CollectedAt: now,
		},
	}

	items, err := detector.Detect(context.Background(), quotes)
	if err != nil {
		t.Fatalf("detect returned error: %v", err)
	}
	if len(items) != 0 {
		t.Fatalf("expected 0 surebet, got %d", len(items))
	}
}
