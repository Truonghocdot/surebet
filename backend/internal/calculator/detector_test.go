package calculator

import (
	"context"
	"math"
	"testing"
	"time"

	"surebet/backend/internal/models"
)

func TestDetectMalayNegativeOverUnderSurebet(t *testing.T) {
	detector := NewDetector()
	now := time.Now().UTC()

	quotes := []models.OddsQuote{
		{
			ID:          "over-a",
			BookmakerID: "book-a",
			LobbyID:     "bti",
			FixtureID:   "fixture-a",
			MarketID:    "ta-i-xi-u",
			MarketName:  "Tài/Xỉu",
			OutcomeID:   "over-a",
			OutcomeName: "Arsenal vs Milan Over 2.5",
			Odds:        -0.78,
			CollectedAt: now,
		},
		{
			ID:          "under-b",
			BookmakerID: "book-b",
			LobbyID:     "cmd",
			FixtureID:   "fixture-b",
			MarketID:    "ta-i-xi-u",
			MarketName:  "Tài/Xỉu",
			OutcomeID:   "under-b",
			OutcomeName: "Arsenal vs Milan Under 2.5",
			Odds:        -0.90,
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

	item := items[0]
	assertAlmostEqual(t, item.ProfitPercentage, 19.0476)
	assertAlmostEqual(t, item.ExpectedReturn, 0.1905)
	if len(item.Legs) != 2 {
		t.Fatalf("expected 2 legs, got %d", len(item.Legs))
	}
	assertAlmostEqual(t, item.Legs[0].Stake, 0.4643)
	assertAlmostEqual(t, item.Legs[1].Stake, 0.5357)
}

func TestDetectMalayNegativeHandicapSurebet(t *testing.T) {
	detector := NewDetector()
	now := time.Now().UTC()

	quotes := []models.OddsQuote{
		{
			ID:          "home-a",
			BookmakerID: "book-a",
			LobbyID:     "saba",
			FixtureID:   "fixture-a",
			HomeTeam:    "Arsenal",
			AwayTeam:    "Milan",
			MarketID:    "cu-o-c-cha-p",
			MarketName:  "Cược chấp",
			OutcomeID:   "home-a",
			OutcomeName: "Arsenal -0.5",
			Odds:        -0.73,
			CollectedAt: now,
		},
		{
			ID:          "away-b",
			BookmakerID: "book-b",
			LobbyID:     "m9bet",
			FixtureID:   "fixture-b",
			HomeTeam:    "Arsenal",
			AwayTeam:    "Milan",
			MarketID:    "cu-o-c-cha-p",
			MarketName:  "Cược chấp",
			OutcomeID:   "away-b",
			OutcomeName: "Milan +0.5",
			Odds:        -0.69,
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

func TestDetectIgnoresMixedSignsAndInsufficientMalayRisk(t *testing.T) {
	detector := NewDetector()
	now := time.Now().UTC()

	quotes := []models.OddsQuote{
		{
			ID:          "mixed-over",
			BookmakerID: "book-a",
			LobbyID:     "bti",
			FixtureID:   "fixture-a",
			MarketID:    "ta-i-xi-u",
			MarketName:  "Tài/Xỉu",
			OutcomeID:   "mixed-over",
			OutcomeName: "PSG vs Dortmund Over 2.5",
			Odds:        -0.62,
			CollectedAt: now,
		},
		{
			ID:          "mixed-under",
			BookmakerID: "book-b",
			LobbyID:     "cmd",
			FixtureID:   "fixture-b",
			MarketID:    "ta-i-xi-u",
			MarketName:  "Tài/Xỉu",
			OutcomeID:   "mixed-under",
			OutcomeName: "PSG vs Dortmund Under 2.5",
			Odds:        0.82,
			CollectedAt: now,
		},
		{
			ID:          "small-home",
			BookmakerID: "book-c",
			LobbyID:     "saba",
			FixtureID:   "fixture-c",
			MarketID:    "cu-o-c-cha-p",
			MarketName:  "Cược chấp",
			OutcomeID:   "small-home",
			OutcomeName: "PSG -0.5",
			Odds:        -0.48,
			CollectedAt: now,
		},
		{
			ID:          "small-away",
			BookmakerID: "book-d",
			LobbyID:     "m9bet",
			FixtureID:   "fixture-d",
			MarketID:    "cu-o-c-cha-p",
			MarketName:  "Cược chấp",
			OutcomeID:   "small-away",
			OutcomeName: "Dortmund +0.5",
			Odds:        -0.50,
			CollectedAt: now,
		},
	}

	items, err := detector.Detect(context.Background(), quotes)
	if err != nil {
		t.Fatalf("detect returned error: %v", err)
	}
	if len(items) != 0 {
		t.Fatalf("expected 0 surebets, got %d", len(items))
	}
}

func TestDetectAllowsDifferentLobbiesOfSameBookmaker(t *testing.T) {
	detector := NewDetector()
	now := time.Now().UTC()

	quotes := []models.OddsQuote{
		{
			ID:          "cmd-over",
			BookmakerID: "jun88",
			LobbyID:     "cmd",
			FixtureID:   "fixture-a",
			HomeTeam:    "Liverpool",
			AwayTeam:    "Milan",
			MarketID:    "ft-over-under",
			MarketName:  "ft-over-under",
			OutcomeID:   "cmd-over",
			OutcomeName: "Over 3.5",
			Odds:        -0.72,
			CollectedAt: now,
		},
		{
			ID:          "saba-under",
			BookmakerID: "jun88",
			LobbyID:     "saba",
			FixtureID:   "fixture-b",
			HomeTeam:    "Liverpool",
			AwayTeam:    "Milan",
			MarketID:    "ta-i-xi-u",
			MarketName:  "ta-i-xi-u",
			OutcomeID:   "saba-under",
			OutcomeName: "Xỉu 3.5",
			Odds:        -0.65,
			CollectedAt: now,
		},
	}

	items, err := detector.Detect(context.Background(), quotes)
	if err != nil {
		t.Fatalf("detect returned error: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected 1 surebet across lobbies, got %d", len(items))
	}
	if items[0].Legs[0].LobbyID == items[0].Legs[1].LobbyID {
		t.Fatalf("expected opportunity to use different lobbies, got %+v", items[0].Legs)
	}
}

func TestDetectUsesHomeAwayTeamsForOverUnderFixtureMatching(t *testing.T) {
	detector := NewDetector()
	now := time.Now().UTC()

	quotes := []models.OddsQuote{
		{
			ID:          "cmd-over",
			BookmakerID: "jun88",
			LobbyID:     "cmd",
			FixtureID:   "cmd-fixture-id",
			HomeTeam:    "USA (Revange)",
			AwayTeam:    "Croatia (Fernando)",
			MarketID:    "ft-over-under",
			MarketName:  "ft-over-under",
			OutcomeID:   "cmd-over",
			OutcomeName: "Over 3.5",
			Odds:        -0.66,
			CollectedAt: now,
		},
		{
			ID:          "saba-under",
			BookmakerID: "jun88",
			LobbyID:     "saba",
			FixtureID:   "saba-fixture-id",
			HomeTeam:    "USA (Revange)",
			AwayTeam:    "Croatia (Fernando)",
			MarketID:    "ft-over-under",
			MarketName:  "ft-over-under",
			OutcomeID:   "saba-under",
			OutcomeName: "Under 3.5",
			Odds:        -0.71,
			CollectedAt: now,
		},
	}

	items, err := detector.Detect(context.Background(), quotes)
	if err != nil {
		t.Fatalf("detect returned error: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected 1 surebet matched by home/away teams, got %d", len(items))
	}
}

func TestDetectSeparatesFullTimeAndFirstHalfMarkets(t *testing.T) {
	detector := NewDetector()
	now := time.Now().UTC()

	quotes := []models.OddsQuote{
		{
			ID:          "ft-over",
			BookmakerID: "book-a",
			LobbyID:     "cmd",
			FixtureID:   "fixture-a",
			MarketID:    "ft-over-under",
			MarketName:  "ft-over-under",
			OutcomeID:   "ft-over",
			OutcomeName: "Over 3.5",
			Odds:        -0.73,
			CollectedAt: now,
		},
		{
			ID:          "1h-under",
			BookmakerID: "book-b",
			LobbyID:     "saba",
			FixtureID:   "fixture-b",
			MarketID:    "1h-over-under",
			MarketName:  "1h-over-under",
			OutcomeID:   "1h-under",
			OutcomeName: "Under 3.5",
			Odds:        -0.72,
			CollectedAt: now,
		},
	}

	items, err := detector.Detect(context.Background(), quotes)
	if err != nil {
		t.Fatalf("detect returned error: %v", err)
	}
	if len(items) != 0 {
		t.Fatalf("expected 0 surebets when only cross-period pairing is possible, got %d", len(items))
	}
}

func assertAlmostEqual(t *testing.T, got, want float64) {
	t.Helper()
	if math.Abs(got-want) > 0.0002 {
		t.Fatalf("expected %.4f, got %.4f", want, got)
	}
}
