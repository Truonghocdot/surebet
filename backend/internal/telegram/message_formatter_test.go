package telegram

import (
	"strings"
	"testing"
	"time"

	"surebet/backend/internal/dto"
)

func TestFormatSurebetMessageAt_FormatsOpportunityLikeDashboardCard(t *testing.T) {
	now := time.Date(2026, 7, 12, 20, 10, 0, 0, time.UTC)
	item := dto.SurebetView{
		ID:               "opp-1",
		FixtureID:        "Arsenal & Chelsea",
		MarketName:       "over-under",
		ProfitPercentage: 1.82,
		DetectedAt:       now.Add(-18 * time.Second),
		ExpiresAt:        time.Date(2026, 7, 12, 20, 15, 3, 0, time.UTC),
		Legs: []dto.SurebetLegView{
			{
				BookmakerID: "8xbet",
				LobbyID:     "BTI",
				OutcomeID:   "leg-1",
				OutcomeName: "Over 2.5",
				Odds:        -0.67,
				Stake:       0.5123,
			},
			{
				BookmakerID: "jun88",
				LobbyID:     "SABA",
				OutcomeID:   "leg-2",
				OutcomeName: "Under 2.5",
				Odds:        1.93,
				Stake:       0.4877,
			},
		},
	}

	got := formatSurebetMessageAt(item, now, time.UTC)
	want := `<b>Arsenal &amp; Chelsea</b>
Tài/Xỉu 2.5

<b>8xbet / BTI</b>
Tài 2.5 | <code>-0.67</code>

<b>jun88 / SABA</b>
Xỉu 2.5 | <code>1.93</code>`

	if got != want {
		t.Fatalf("formatted message mismatch\nwant:\n%s\n\ngot:\n%s", want, got)
	}
}

func TestFormatSurebetMessageAt_FormatsHandicapFallbacks(t *testing.T) {
	now := time.Date(2026, 7, 12, 20, 10, 0, 0, time.UTC)
	item := dto.SurebetView{
		ID:               "opp-2",
		FixtureID:        "Team A vs Team B",
		MarketName:       "handicap",
		ProfitPercentage: 0.75,
		DetectedAt:       now.Add(-95 * time.Second),
		ExpiresAt:        time.Date(2026, 7, 12, 20, 11, 30, 0, time.UTC),
		Legs: []dto.SurebetLegView{
			{
				BookmakerID: "m9bet",
				LobbyID:     "",
				OutcomeID:   "leg-1",
				OutcomeName: "Team A -0.5",
				Odds:        0.91,
				Stake:       0.505,
			},
			{
				BookmakerID: "jun88",
				LobbyID:     "CMD",
				OutcomeID:   "leg-2",
				OutcomeName: "Team B +0.5",
				Odds:        0.89,
				Stake:       0.495,
			},
		},
	}

	got := formatSurebetMessageAt(item, now, time.UTC)
	want := `<b>Team A vs Team B</b>
Kèo chấp 0.5

<b>m9bet / -</b>
Team A -0.5 | <code>0.91</code>

<b>jun88 / CMD</b>
Team B +0.5 | <code>0.89</code>`

	if got != want {
		t.Fatalf("formatted message mismatch\nwant:\n%s\n\ngot:\n%s", want, got)
	}
}

func TestFormatSurebetMessageAtKeepsRawOddsPrecision(t *testing.T) {
	now := time.Date(2026, 7, 12, 20, 10, 0, 0, time.UTC)
	item := dto.SurebetView{
		FixtureID:  "Team A vs Team B",
		DetectedAt: now,
		ExpiresAt:  now.Add(time.Minute),
		Legs: []dto.SurebetLegView{
			{BookmakerID: "book-a", LobbyID: "main", OutcomeName: "Over 2.5", Odds: -0.6789},
		},
	}

	message := formatSurebetMessageAt(item, now, time.UTC)
	if !strings.Contains(message, "<code>-0.6789</code>") {
		t.Fatalf("expected raw odds precision in message, got:\n%s", message)
	}
	if strings.Contains(message, "Tỷ trọng vốn") || strings.Contains(message, "Lãi surebet") || strings.Contains(message, "Lệch tiền") {
		t.Fatalf("expected odds-only message, got:\n%s", message)
	}
}
