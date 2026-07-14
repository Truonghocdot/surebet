package collector

import (
	"context"
	"testing"
	"time"

	"surebet/backend/internal/dto"
	"surebet/backend/internal/logger"
	"surebet/backend/internal/models"
)

func TestBuildFixtureMarkerIgnoresEventStartAt(t *testing.T) {
	first := buildFixtureMarker(dto.CollectorSelection{
		FixtureID:    "fixture-a",
		HomeTeam:     "Team A",
		AwayTeam:     "Team B",
		EventStartAt: "07/11 20:00",
	})
	second := buildFixtureMarker(dto.CollectorSelection{
		FixtureID:    "fixture-b",
		HomeTeam:     "Team A",
		AwayTeam:     "Team B",
		EventStartAt: "07/11 21:00",
	})

	if first != "team-a|team-b" {
		t.Fatalf("expected fixture marker to use only teams, got %q", first)
	}
	if second != first {
		t.Fatalf("expected fixture marker to ignore event start time, got %q and %q", first, second)
	}
}

func TestBuildQuoteUsesCompatibleSportFallback(t *testing.T) {
	now := time.Date(2026, 7, 14, 10, 0, 0, 0, time.UTC)
	selection := dto.CollectorSelection{
		FixtureID:   "fixture-a",
		HomeTeam:    "Team A",
		AwayTeam:    "Team B",
		MarketID:    "over-under",
		OutcomeID:   "over",
		OutcomeName: "Over 2.5",
	}

	legacySource := dto.CollectorSource{BookmakerID: "jun88", LobbyID: "cmd"}
	if quote := buildQuote(legacySource, now, selection); quote.Sport != "football" {
		t.Fatalf("expected legacy football source fallback, got %q", quote.Sport)
	}

	selection.Sport = "Basketball"
	if quote := buildQuote(legacySource, now, selection); quote.Sport != "basketball" {
		t.Fatalf("expected explicit sport to be normalized, got %q", quote.Sport)
	}

	unknownSource := dto.CollectorSource{BookmakerID: "other", LobbyID: "default"}
	selection.Sport = ""
	if quote := buildQuote(unknownSource, now, selection); quote.Sport != "" {
		t.Fatalf("expected unknown source without sport to remain empty, got %q", quote.Sport)
	}
}

func TestBuildQuoteKeepsIncompleteIdentityForStorage(t *testing.T) {
	quote := buildQuote(dto.CollectorSource{BookmakerID: "jun88", LobbyID: "cmd"}, time.Now().UTC(), dto.CollectorSelection{
		FixtureID:   "fixture-a",
		HomeTeam:    "",
		AwayTeam:    "Team B",
		MarketID:    "over-under",
		OutcomeID:   "over",
		OutcomeName: "Over 2.5",
	})
	if quote.HomeTeam != "" || quote.AwayTeam != "Team B" {
		t.Fatalf("expected incomplete identity to be retained for storage, got %+v", quote)
	}
}

func TestLogDetectorIdentityGapsAggregatesWarnings(t *testing.T) {
	log := &recordingLogger{}
	service := apiService{log: log}
	service.logDetectorIdentityGaps([]models.OddsQuote{
		{BookmakerID: "jun88", LobbyID: "cmd", Sport: "football", AwayTeam: "Milan"},
		{BookmakerID: "jun88", LobbyID: "cmd", Sport: ""},
		{BookmakerID: "jun88", LobbyID: "cmd", Sport: ""},
	})

	if len(log.warnings) != 2 {
		t.Fatalf("expected one warning per source/reason, got %+v", log.warnings)
	}
	for _, warning := range log.warnings {
		if warning.message != "collector quotes excluded from surebet detection" {
			t.Fatalf("unexpected warning: %+v", warning)
		}
	}
}

func TestReplaceSourceSnapshotPrefersAuthoritativeBootstrapWriter(t *testing.T) {
	now := time.Date(2026, 7, 14, 10, 0, 0, 0, time.UTC)
	writer := &recordingOddsWriter{}
	service := apiService{writer: writer}
	quotes := []models.OddsQuote{{ID: "quote-a"}}

	err := service.replaceSourceSnapshot(
		context.Background(),
		dto.CollectorSource{BookmakerID: "8xbet", LobbyID: "default"},
		now,
		quotes,
	)
	if err != nil {
		t.Fatalf("replace source snapshot returned error: %v", err)
	}
	if !writer.replaceCalled {
		t.Fatal("expected authoritative bootstrap writer to be used")
	}
	if writer.replaceBookmakerID != "8xbet" || writer.replaceLobbyID != "default" {
		t.Fatalf("unexpected source passed to replace writer: %+v", writer)
	}
	if !writer.replaceCollectedAt.Equal(now) {
		t.Fatalf("unexpected collected_at passed to replace writer: %s", writer.replaceCollectedAt)
	}
	if len(writer.replaceQuotes) != 1 || writer.replaceQuotes[0].ID != "quote-a" {
		t.Fatalf("unexpected quotes passed to replace writer: %+v", writer.replaceQuotes)
	}
	if writer.upsertCalled {
		t.Fatal("expected fallback upsert not to be used when replace writer is available")
	}
}

type logEntry struct {
	message string
	fields  []any
}

type recordingLogger struct {
	warnings []logEntry
}

type recordingOddsWriter struct {
	upsertCalled       bool
	replaceCalled      bool
	replaceBookmakerID string
	replaceLobbyID     string
	replaceCollectedAt time.Time
	replaceQuotes      []models.OddsQuote
}

func (w *recordingOddsWriter) Upsert(_ context.Context, _ []models.OddsQuote) error {
	w.upsertCalled = true
	return nil
}

func (w *recordingOddsWriter) ListByFixture(context.Context, string) ([]models.OddsQuote, error) {
	return nil, nil
}

func (w *recordingOddsWriter) ReplaceSourceSnapshot(
	_ context.Context,
	bookmakerID, lobbyID string,
	collectedAt time.Time,
	quotes []models.OddsQuote,
) error {
	w.replaceCalled = true
	w.replaceBookmakerID = bookmakerID
	w.replaceLobbyID = lobbyID
	w.replaceCollectedAt = collectedAt
	w.replaceQuotes = append([]models.OddsQuote(nil), quotes...)
	return nil
}

func (l *recordingLogger) With(...any) logger.Logger {
	return l
}

func (l *recordingLogger) Info(string, ...any) {}

func (l *recordingLogger) Warn(message string, fields ...any) {
	l.warnings = append(l.warnings, logEntry{message: message, fields: fields})
}

func (l *recordingLogger) Error(string, ...any) {}
