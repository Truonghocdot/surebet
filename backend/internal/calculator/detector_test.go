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
			FixtureID:   "fixture-a",
			MarketID:    "ta-i-xi-u",
			MarketName:  "Tài/Xỉu",
			OutcomeID:   "over-a",
			OutcomeName: "Arsenal vs Milan Over 2.5",
			Odds:        0.95,
			CollectedAt: now,
		},
		{
			ID:          "b1",
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
			LobbyID:     "saba",
			FixtureID:   "fixture-a",
			MarketID:    "cu-o-c-cha-p",
			MarketName:  "Cược chấp",
			OutcomeID:   "home-a",
			OutcomeName: "Arsenal vs Milan Home -0.5",
			Odds:        0.97,
			CollectedAt: now,
		},
		{
			ID:          "b2",
			BookmakerID: "book-b",
			LobbyID:     "m9bet",
			FixtureID:   "fixture-b",
			MarketID:    "cu-o-c-cha-p",
			MarketName:  "Cược chấp",
			OutcomeID:   "away-b",
			OutcomeName: "Arsenal vs Milan Away +0.5",
			Odds:        -0.92,
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
			FixtureID:   "fixture-a",
			MarketID:    "ta-i-xi-u",
			MarketName:  "Tài/Xỉu",
			OutcomeID:   "over-a",
			OutcomeName: "PSG vs Dortmund Over 2.5",
			Odds:        0.8,
			CollectedAt: now,
		},
		{
			ID:          "b3",
			BookmakerID: "book-b",
			LobbyID:     "cmd",
			FixtureID:   "fixture-b",
			MarketID:    "ta-i-xi-u",
			MarketName:  "Tài/Xỉu",
			OutcomeID:   "under-b",
			OutcomeName: "PSG vs Dortmund Under 2.5",
			Odds:        0.82,
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

func TestDetectAllowsDifferentLobbiesOfSameBookmaker(t *testing.T) {
	detector := NewDetector()
	now := time.Now().UTC()

	quotes := []models.OddsQuote{
		{
			ID:          "cmd-over",
			BookmakerID: "jun88",
			LobbyID:     "cmd",
			FixtureID:   "fixture-a",
			MarketID:    "ft-over-under",
			MarketName:  "ft-over-under",
			OutcomeID:   "cmd-over",
			OutcomeName: "Over 3.5",
			Odds:        0.98,
			CollectedAt: now,
		},
		{
			ID:          "cmd-home",
			BookmakerID: "jun88",
			LobbyID:     "cmd",
			FixtureID:   "fixture-a",
			MarketID:    "ft-handicap",
			MarketName:  "ft-handicap",
			OutcomeID:   "cmd-home",
			OutcomeName: "Liverpool -0.5",
			Odds:        0.82,
			CollectedAt: now,
		},
		{
			ID:          "cmd-away",
			BookmakerID: "jun88",
			LobbyID:     "cmd",
			FixtureID:   "fixture-a",
			MarketID:    "ft-handicap",
			MarketName:  "ft-handicap",
			OutcomeID:   "cmd-away",
			OutcomeName: "Milan +0.5",
			Odds:        0.84,
			CollectedAt: now,
		},
		{
			ID:          "saba-under",
			BookmakerID: "jun88",
			LobbyID:     "saba",
			FixtureID:   "fixture-b",
			MarketID:    "ta-i-xi-u",
			MarketName:  "ta-i-xi-u",
			OutcomeID:   "saba-under",
			OutcomeName: "Xỉu 3.5",
			Odds:        -0.9,
			CollectedAt: now,
		},
		{
			ID:          "saba-home",
			BookmakerID: "jun88",
			LobbyID:     "saba",
			FixtureID:   "fixture-b",
			MarketID:    "cu-o-c-cha-p",
			MarketName:  "cu-o-c-cha-p",
			OutcomeID:   "saba-home",
			OutcomeName: "Liverpool -0.5",
			Odds:        0.8,
			CollectedAt: now,
		},
		{
			ID:          "saba-away",
			BookmakerID: "jun88",
			LobbyID:     "saba",
			FixtureID:   "fixture-b",
			MarketID:    "cu-o-c-cha-p",
			MarketName:  "cu-o-c-cha-p",
			OutcomeID:   "saba-away",
			OutcomeName: "Milan +0.5",
			Odds:        0.8,
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
			Odds:        0.98,
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
			Odds:        -0.9,
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

func TestDetectTreatsAsianOddsOneAsDecimalTwo(t *testing.T) {
	detector := NewDetector()
	now := time.Now().UTC()

	quotes := []models.OddsQuote{
		{
			ID:          "cmd-over",
			BookmakerID: "jun88",
			LobbyID:     "cmd",
			FixtureID:   "fixture-a",
			HomeTeam:    "USA (Uncle)",
			AwayTeam:    "Scotland (v1nn)",
			MarketID:    "ft-over-under",
			MarketName:  "ft-over-under",
			OutcomeID:   "cmd-over",
			OutcomeName: "Over 6",
			Odds:        1.00,
			CollectedAt: now,
		},
		{
			ID:          "saba-under",
			BookmakerID: "jun88",
			LobbyID:     "saba",
			FixtureID:   "fixture-b",
			HomeTeam:    "USA (Uncle)",
			AwayTeam:    "Scotland (v1nn)",
			MarketID:    "ft-over-under",
			MarketName:  "ft-over-under",
			OutcomeID:   "saba-under",
			OutcomeName: "Under 6",
			Odds:        -0.93,
			CollectedAt: now,
		},
	}

	items, err := detector.Detect(context.Background(), quotes)
	if err != nil {
		t.Fatalf("detect returned error: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected 1 surebet with asian odds 1.00 treated as decimal 2.00, got %d", len(items))
	}
}

func TestDetectKeepsEightXBetDecimalOdds(t *testing.T) {
	detector := NewDetector()
	now := time.Now().UTC()

	quotes := []models.OddsQuote{
		{
			ID:          "eight-home",
			BookmakerID: "8xbet",
			LobbyID:     "default",
			FixtureID:   "eight-fixture",
			HomeTeam:    "Gilla FC",
			AwayTeam:    "HooGee",
			MarketID:    "cu-o-c-cha-pcu-o-c-cha-p",
			MarketName:  "Cược ChấpCược Chấp",
			OutcomeID:   "eight-home",
			OutcomeName: "Gilla FC -1",
			Odds:        1.76,
			CollectedAt: now,
		},
		{
			ID:          "jun-away",
			BookmakerID: "jun88",
			LobbyID:     "cmd",
			FixtureID:   "jun-fixture",
			HomeTeam:    "Gilla FC",
			AwayTeam:    "HooGee",
			MarketID:    "ft-handicap",
			MarketName:  "ft-handicap",
			OutcomeID:   "jun-away",
			OutcomeName: "HooGee +1",
			Odds:        0.88,
			CollectedAt: now,
		},
	}

	items, err := detector.Detect(context.Background(), quotes)
	if err != nil {
		t.Fatalf("detect returned error: %v", err)
	}
	if len(items) != 0 {
		t.Fatalf("expected 0 surebets when 8xbet decimal odds are kept as-is, got %d", len(items))
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
			Odds:        0.95,
			CollectedAt: now,
		},
		{
			ID:          "ft-home",
			BookmakerID: "book-a",
			LobbyID:     "cmd",
			FixtureID:   "fixture-a",
			MarketID:    "ft-handicap",
			MarketName:  "ft-handicap",
			OutcomeID:   "ft-home",
			OutcomeName: "Arsenal -0.5",
			Odds:        0.8,
			CollectedAt: now,
		},
		{
			ID:          "ft-away",
			BookmakerID: "book-a",
			LobbyID:     "cmd",
			FixtureID:   "fixture-a",
			MarketID:    "ft-handicap",
			MarketName:  "ft-handicap",
			OutcomeID:   "ft-away",
			OutcomeName: "Milan +0.5",
			Odds:        0.8,
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
			Odds:        0.95,
			CollectedAt: now,
		},
		{
			ID:          "1h-home",
			BookmakerID: "book-b",
			LobbyID:     "saba",
			FixtureID:   "fixture-b",
			MarketID:    "1h-handicap",
			MarketName:  "1h-handicap",
			OutcomeID:   "1h-home",
			OutcomeName: "Arsenal -0.5",
			Odds:        0.8,
			CollectedAt: now,
		},
		{
			ID:          "1h-away",
			BookmakerID: "book-b",
			LobbyID:     "saba",
			FixtureID:   "fixture-b",
			MarketID:    "1h-handicap",
			MarketName:  "1h-handicap",
			OutcomeID:   "1h-away",
			OutcomeName: "Milan +0.5",
			Odds:        0.8,
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
