package calculator

import (
	"context"
	"math"
	"testing"
	"time"

	"surebet/backend/internal/models"
)

func TestNormalizeMalayOdds(t *testing.T) {
	tests := []struct {
		name  string
		input float64
		want  float64
		ok    bool
	}{
		{name: "negative", input: -0.5, want: 3, ok: true},
		{name: "negative boundary", input: -1, want: 2, ok: true},
		{name: "positive", input: 0.5, want: 1.5, ok: true},
		{name: "positive boundary", input: 1, want: 2, ok: true},
		{name: "zero", input: 0, ok: false},
		{name: "outside positive range", input: 1.01, ok: false},
		{name: "outside negative range", input: -1.01, ok: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, ok := normalizeMalayOdds(test.input)
			if ok != test.ok {
				t.Fatalf("expected ok=%t, got %t", test.ok, ok)
			}
			if ok {
				assertAlmostEqual(t, got, test.want)
			}
		})
	}
}

func TestDetectOverUnderUsesDecimalOddsAndBestQuote(t *testing.T) {
	now := time.Date(2026, 7, 14, 10, 0, 0, 0, time.UTC)
	detector := newDetector(func() time.Time { return now })
	quotes := []models.OddsQuote{
		testQuote(now, "over-worse", "book-a", "bti", "Arsenal", "Milan", "Premier League", "Over 2.5", -0.75),
		testQuote(now, "over-best", "book-a", "bti", "Arsenal", "Milan", "Premier League", "Over 2.5", -0.5),
		testQuote(now, "under-positive", "book-b", "cmd", "Arsenal", "Milan", "Premier League", "Under 2.5", 0.8),
	}

	items := detect(t, detector, quotes)
	if len(items) != 1 {
		t.Fatalf("expected 1 surebet, got %d", len(items))
	}

	item := items[0]
	assertAlmostEqual(t, item.ExpectedReturn, 0.125)
	assertAlmostEqual(t, item.ProfitPercentage, 12.5)
	assertAlmostEqual(t, item.Legs[0].Stake+item.Legs[1].Stake, 1)
	if !containsOutcomeID(item.Legs, "over-best") {
		t.Fatalf("expected best decimal quote to be selected, got %+v", item.Legs)
	}
}

func TestDetectRejectsNonArbitrageDecimalOdds(t *testing.T) {
	now := time.Date(2026, 7, 14, 10, 0, 0, 0, time.UTC)
	detector := newDetector(func() time.Time { return now })
	quotes := []models.OddsQuote{
		testQuote(now, "over", "book-a", "bti", "Arsenal", "Milan", "", "Over 2.5", 0.5),
		testQuote(now, "under", "book-b", "cmd", "Arsenal", "Milan", "", "Under 2.5", 0.5),
	}

	if items := detect(t, detector, quotes); len(items) != 0 {
		t.Fatalf("expected non-arbitrage decimal odds to be rejected, got %+v", items)
	}
}

func TestDetectAllowsDifferentLobbiesOfTheSameBookmaker(t *testing.T) {
	now := time.Date(2026, 7, 14, 10, 0, 0, 0, time.UTC)
	detector := newDetector(func() time.Time { return now })
	quotes := []models.OddsQuote{
		testQuote(now, "over", "jun88", "cmd", "Arsenal", "Milan", "", "Over 2.5", -0.5),
		testQuote(now, "under", "jun88", "saba", "Arsenal", "Milan", "", "Under 2.5", -0.5),
	}

	if items := detect(t, detector, quotes); len(items) != 1 {
		t.Fatalf("expected quotes from different lobbies of the same bookmaker to match, got %+v", items)
	}
}

func TestDetectRejectsQuotesWithoutDetectorIdentity(t *testing.T) {
	now := time.Date(2026, 7, 14, 10, 0, 0, 0, time.UTC)
	detector := newDetector(func() time.Time { return now })

	missingTeams := []models.OddsQuote{
		testQuote(now, "over", "book-a", "bti", "", "", "", "Over 2.5", -0.5),
		testQuote(now, "under", "book-b", "cmd", "", "", "", "Under 2.5", -0.5),
	}
	if items := detect(t, detector, missingTeams); len(items) != 0 {
		t.Fatalf("expected quotes without teams to be excluded, got %+v", items)
	}

	missingSport := []models.OddsQuote{
		withoutSport(testQuote(now, "over", "book-a", "bti", "Arsenal", "Milan", "", "Over 2.5", -0.5)),
		withoutSport(testQuote(now, "under", "book-b", "cmd", "Arsenal", "Milan", "", "Under 2.5", -0.5)),
	}
	if items := detect(t, detector, missingSport); len(items) != 0 {
		t.Fatalf("expected quotes without sport to be excluded, got %+v", items)
	}
}

func TestDetectMatchesCanonicalTeamsAndAllowsMissingOptionalMetadata(t *testing.T) {
	now := time.Date(2026, 7, 14, 10, 0, 0, 0, time.UTC)
	detector := newDetector(func() time.Time { return now })
	quotes := []models.OddsQuote{
		testQuote(now, "over", "book-a", "bti", "Atletico Madrid", "Croatia (Fernando)", "Premier League", "Over 3.5", -0.5),
		testQuote(now, "under", "book-b", "cmd", "Croatia Fernando", "Atlético Madrid", "", "Under 3.5", -0.5),
	}

	items := detect(t, detector, quotes)
	if len(items) != 1 {
		t.Fatalf("expected canonical team names to match, got %d", len(items))
	}
}

func TestDetectSeparatesDifferentSports(t *testing.T) {
	now := time.Date(2026, 7, 14, 10, 0, 0, 0, time.UTC)
	detector := newDetector(func() time.Time { return now })
	over := testQuote(now, "over", "book-a", "bti", "Arsenal", "Milan", "", "Over 2.5", -0.5)
	under := testQuote(now, "under", "book-b", "cmd", "Arsenal", "Milan", "", "Under 2.5", -0.5)
	under.Sport = "basketball"

	if items := detect(t, detector, []models.OddsQuote{over, under}); len(items) != 0 {
		t.Fatalf("expected different sports to be separated, got %+v", items)
	}
}

func TestDetectMatchesEventsRegardlessOfLeagueAndStartTime(t *testing.T) {
	now := time.Date(2026, 7, 14, 10, 0, 0, 0, time.UTC)

	tests := []struct {
		name   string
		mutate func(*models.OddsQuote)
	}{
		{
			name: "different league",
			mutate: func(quote *models.OddsQuote) {
				quote.LeagueName = "La Liga"
			},
		},
		{
			name: "start time beyond tolerance",
			mutate: func(quote *models.OddsQuote) {
				start := now.Add(11 * time.Minute)
				quote.EventStartAt = &start
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			detector := newDetector(func() time.Time { return now })
			over := testQuote(now, "over", "book-a", "bti", "Arsenal", "Milan", "Premier League", "Over 2.5", -0.5)
			under := testQuote(now, "under", "book-b", "cmd", "Arsenal", "Milan", "Premier League", "Under 2.5", -0.5)
			start := now.Add(2 * time.Hour)
			over.EventStartAt = &start
			under.EventStartAt = &start
			test.mutate(&under)

			if items := detect(t, detector, []models.OddsQuote{over, under}); len(items) != 1 {
				t.Fatalf("expected matching teams to be paired despite metadata differences, got %+v", items)
			}
		})
	}
}

func TestDetectHandicapMatchesActualParticipantsAcrossReversedTeams(t *testing.T) {
	now := time.Date(2026, 7, 14, 10, 0, 0, 0, time.UTC)
	detector := newDetector(func() time.Time { return now })
	quotes := []models.OddsQuote{
		testHandicapQuote(now, "arsenal", "book-a", "saba", "Arsenal", "Milan", "Arsenal -0.5", -0.5),
		testHandicapQuote(now, "milan", "book-b", "cmd", "Milan", "Arsenal", "Milan +0.5", -0.5),
	}

	items := detect(t, detector, quotes)
	if len(items) != 1 {
		t.Fatalf("expected handicap with reversed home/away teams to match, got %d", len(items))
	}
}

func TestDetectHandicapRejectsSameParticipantAndNonOppositeLines(t *testing.T) {
	now := time.Date(2026, 7, 14, 10, 0, 0, 0, time.UTC)
	detector := newDetector(func() time.Time { return now })

	tests := []struct {
		name  string
		right models.OddsQuote
	}{
		{
			name:  "same participant",
			right: testHandicapQuote(now, "arsenal-b", "book-b", "cmd", "Milan", "Arsenal", "Arsenal +0.5", -0.5),
		},
		{
			name:  "same line sign",
			right: testHandicapQuote(now, "milan-b", "book-b", "cmd", "Milan", "Arsenal", "Milan -0.5", -0.5),
		},
	}

	left := testHandicapQuote(now, "arsenal-a", "book-a", "saba", "Arsenal", "Milan", "Arsenal -0.5", -0.5)
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if items := detect(t, detector, []models.OddsQuote{left, test.right}); len(items) != 0 {
				t.Fatalf("expected invalid handicap pair to be rejected, got %+v", items)
			}
		})
	}
}

func TestDetectHandicapMatchesSplitAsianLines(t *testing.T) {
	now := time.Date(2026, 7, 14, 10, 0, 0, 0, time.UTC)
	detector := newDetector(func() time.Time { return now })
	quotes := []models.OddsQuote{
		testHandicapQuote(now, "arsenal", "book-a", "saba", "Arsenal", "Milan", "Arsenal -0.5/1", -0.5),
		testHandicapQuote(now, "milan", "book-b", "cmd", "Arsenal", "Milan", "Milan +0.5/1", -0.5),
	}

	if items := detect(t, detector, quotes); len(items) != 1 {
		t.Fatalf("expected split Asian handicap lines to match, got %+v", items)
	}
}

func TestDetectRejectsStaleQuotesAndAllowsFreshTimestampSkew(t *testing.T) {
	now := time.Date(2026, 7, 14, 10, 0, 0, 0, time.UTC)
	tests := []struct {
		name    string
		overAt  time.Time
		underAt time.Time
		want    int
	}{
		{name: "stale", overAt: now.Add(-61 * time.Second), underAt: now, want: 0},
		{name: "skewed but fresh", overAt: now.Add(-20 * time.Second), underAt: now, want: 1},
		{name: "fresh pair", overAt: now.Add(-20 * time.Second), underAt: now.Add(-15 * time.Second), want: 1},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			detector := newDetector(func() time.Time { return now })
			over := testQuote(test.overAt, "over", "book-a", "bti", "Arsenal", "Milan", "", "Over 2.5", -0.5)
			under := testQuote(test.underAt, "under", "book-b", "cmd", "Arsenal", "Milan", "", "Under 2.5", -0.5)
			items := detect(t, detector, []models.OddsQuote{over, under})
			if len(items) != test.want {
				t.Fatalf("expected %d opportunities, got %d", test.want, len(items))
			}
			if test.name == "fresh pair" {
				if !items[0].ExpiresAt.Equal(now.Add(40 * time.Second)) {
					t.Fatalf("expected expiry from oldest quote, got %s", items[0].ExpiresAt)
				}
				if !items[0].DetectedAt.Equal(now) {
					t.Fatalf("expected detected at %s, got %s", now, items[0].DetectedAt)
				}
			}
		})
	}
}

func TestHasCompatibleQuoteTimes(t *testing.T) {
	now := time.Date(2026, 7, 14, 10, 0, 0, 0, time.UTC)
	if !hasCompatibleQuoteTimes(now, now.Add(-5*time.Minute)) {
		t.Fatal("expected timestamps exactly five minutes apart to be compatible")
	}
	if hasCompatibleQuoteTimes(now, now.Add(-5*time.Minute-time.Nanosecond)) {
		t.Fatal("expected timestamps more than five minutes apart to be incompatible")
	}
}

func TestDetectSeparatesFullTimeAndFirstHalfMarkets(t *testing.T) {
	now := time.Date(2026, 7, 14, 10, 0, 0, 0, time.UTC)
	detector := newDetector(func() time.Time { return now })
	quotes := []models.OddsQuote{
		testQuoteWithMarket(now, "ft-over", "book-a", "bti", "Arsenal", "Milan", "ft-over-under", "Over 2.5", -0.5),
		testQuoteWithMarket(now, "1h-under", "book-b", "cmd", "Arsenal", "Milan", "1h-over-under", "Under 2.5", -0.5),
	}
	if items := detect(t, detector, quotes); len(items) != 0 {
		t.Fatalf("expected full-time and first-half markets not to match, got %+v", items)
	}
}

func detect(t *testing.T, detector Detector, quotes []models.OddsQuote) []models.SurebetOpportunity {
	t.Helper()
	items, err := detector.Detect(context.Background(), quotes)
	if err != nil {
		t.Fatalf("detect returned error: %v", err)
	}
	return items
}

func testQuote(
	collectedAt time.Time,
	id, bookmakerID, lobbyID, homeTeam, awayTeam, leagueName, outcomeName string,
	odds float64,
) models.OddsQuote {
	return testQuoteWithMarketAndLeague(
		collectedAt,
		id,
		bookmakerID,
		lobbyID,
		homeTeam,
		awayTeam,
		leagueName,
		"ft-over-under",
		outcomeName,
		odds,
	)
}

func testQuoteWithMarket(
	collectedAt time.Time,
	id, bookmakerID, lobbyID, homeTeam, awayTeam, marketID, outcomeName string,
	odds float64,
) models.OddsQuote {
	return testQuoteWithMarketAndLeague(
		collectedAt,
		id,
		bookmakerID,
		lobbyID,
		homeTeam,
		awayTeam,
		"",
		marketID,
		outcomeName,
		odds,
	)
}

func testQuoteWithMarketAndLeague(
	collectedAt time.Time,
	id, bookmakerID, lobbyID, homeTeam, awayTeam, leagueName, marketID, outcomeName string,
	odds float64,
) models.OddsQuote {
	return models.OddsQuote{
		ID:          id,
		BookmakerID: bookmakerID,
		LobbyID:     lobbyID,
		FixtureID:   id + "-fixture",
		HomeTeam:    homeTeam,
		AwayTeam:    awayTeam,
		LeagueName:  leagueName,
		Sport:       "football",
		MarketID:    marketID,
		MarketName:  marketID,
		OutcomeID:   id,
		OutcomeName: outcomeName,
		Odds:        odds,
		CollectedAt: collectedAt,
	}
}

func testHandicapQuote(
	collectedAt time.Time,
	id, bookmakerID, lobbyID, homeTeam, awayTeam, outcomeName string,
	odds float64,
) models.OddsQuote {
	quote := testQuoteWithMarketAndLeague(
		collectedAt,
		id,
		bookmakerID,
		lobbyID,
		homeTeam,
		awayTeam,
		"Premier League",
		"handicap",
		outcomeName,
		odds,
	)
	quote.MarketName = "Handicap"
	return quote
}

func withoutSport(quote models.OddsQuote) models.OddsQuote {
	quote.Sport = ""
	return quote
}

func containsOutcomeID(legs []models.SurebetLeg, outcomeID string) bool {
	for _, leg := range legs {
		if leg.OutcomeID == outcomeID {
			return true
		}
	}
	return false
}

func assertAlmostEqual(t *testing.T, got, want float64) {
	t.Helper()
	if math.Abs(got-want) > 0.0002 {
		t.Fatalf("expected %.4f, got %.4f", want, got)
	}
}
