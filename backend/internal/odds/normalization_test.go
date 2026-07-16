package odds

import (
	"testing"

	"surebet/backend/internal/models"
)

func TestNormalizeViewMarketTypeRecognizesEightXBetLiveMarketCodes(t *testing.T) {
	tests := []struct {
		name       string
		marketID   string
		marketName string
		want       string
	}{
		{
			name:       "handicap ah token",
			marketID:   "hdp-ah",
			marketName: "hdp-ah",
			want:       viewMarketHandicap,
		},
		{
			name:       "over under ou token",
			marketID:   "o-u-ou",
			marketName: "o-u-ou",
			want:       viewMarketOverUnder,
		},
		{
			name:       "first half token",
			marketID:   "cu-o-c-cha-p-ah-1st",
			marketName: "cu-o-c-cha-p-ah-1st",
			want:       viewMarketHandicap,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := normalizeViewMarketType(test.marketID, test.marketName); got != test.want {
				t.Fatalf("expected market type %q, got %q", test.want, got)
			}
		})
	}
}

func TestNormalizeViewMarketTypeRejectsEightXBetExoticOverUnderMarkets(t *testing.T) {
	tests := []struct {
		name       string
		marketID   string
		marketName string
	}{
		{
			name:       "home team goals over under",
			marketID:   "ba-n-tha-ng-do-i-nha-ta-i-xi-u-h-ou",
			marketName: "ba-n-tha-ng-do-i-nha-ta-i-xi-u-h-ou",
		},
		{
			name:       "away team goals over under",
			marketID:   "ba-n-tha-ng-do-i-kha-ch-ta-i-xi-u-a-ou",
			marketName: "ba-n-tha-ng-do-i-kha-ch-ta-i-xi-u-a-ou",
		},
		{
			name:       "both teams to score",
			marketID:   "ca-hai-do-i-de-u-ghi-ba-n-btts",
			marketName: "ca-hai-do-i-de-u-ghi-ba-n-btts",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := normalizeViewMarketType(test.marketID, test.marketName); got != "" {
				t.Fatalf("expected exotic market to be ignored, got %q", got)
			}
		})
	}
}

func TestNormalizeViewPeriodRecognizesFirstHalfMarketCodeToken(t *testing.T) {
	if got := normalizeViewPeriod("o-u-ou-1st", "o-u-ou-1st"); got != "1H" {
		t.Fatalf("expected 1H period, got %q", got)
	}
}

func TestNormalizeQuoteViewRecognizesEightXBetLiveRows(t *testing.T) {
	quote := models.OddsQuote{
		BookmakerID: "8xbet",
		LobbyID:     "default",
		HomeTeam:    "Tianjin Shengde(W)",
		AwayTeam:    "Shanxi Xihua(W)",
		MarketID:    "hdp-ah",
		MarketName:  "hdp-ah",
		OutcomeName: "Tianjin Shengde(W) -0/0.5",
		Odds:        -0.69,
	}

	normalized := normalizeQuoteView(quote)
	if normalized.MarketType != viewMarketHandicap {
		t.Fatalf("expected handicap market, got %q", normalized.MarketType)
	}
	if normalized.Period != "FT" {
		t.Fatalf("expected FT period, got %q", normalized.Period)
	}
	if normalized.Line != "0/0.5" {
		t.Fatalf("expected line 0/0.5, got %q", normalized.Line)
	}
	if normalized.Side != "home" {
		t.Fatalf("expected home side, got %q", normalized.Side)
	}
}
