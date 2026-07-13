package telegram

import (
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
	want := `<b>Kèo mới</b> | 18 giây trước
Lệch tiền <b>1.26</b> | Lãi surebet <b>1.82%</b>

<b>Arsenal &amp; Chelsea</b>
Tài/Xỉu 2.5
Hết hạn 20:15:03

<b>Cửa 1 | 8xbet / BTI</b> <code>-0.67</code>
Cửa đối ứng: <b>Tài 2.5</b>
Tỷ trọng vốn: <b>51.23%</b>
Odds gốc: -0.67

<b>Cửa 2 | jun88 / SABA</b> <code>+1.93</code>
Cửa đối ứng: <b>Xỉu 2.5</b>
Tỷ trọng vốn: <b>48.77%</b>
Odds gốc: 1.93`

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
	want := `<b>Kèo mới</b> | 1 phút trước
Lệch tiền <b>0.02</b> | Lãi surebet <b>0.75%</b>

<b>Team A vs Team B</b>
Kèo chấp 0.5
Hết hạn 20:11:30

<b>Cửa 1 | m9bet / -</b> <code>+0.91</code>
Cửa đối ứng: <b>Team A -0.5</b>
Tỷ trọng vốn: <b>50.50%</b>
Odds gốc: 0.91

<b>Cửa 2 | jun88 / CMD</b> <code>+0.89</code>
Cửa đối ứng: <b>Team B +0.5</b>
Tỷ trọng vốn: <b>49.50%</b>
Odds gốc: 0.89`

	if got != want {
		t.Fatalf("formatted message mismatch\nwant:\n%s\n\ngot:\n%s", want, got)
	}
}
