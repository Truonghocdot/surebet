package collector

import (
	"testing"
	"time"

	"surebet/backend/internal/models"
)

func TestBuildOddsUpdatedEventIncludesSuspendedState(t *testing.T) {
	collectedAt := time.Date(2026, 7, 18, 8, 0, 0, 0, time.UTC)
	observedAt := collectedAt.Add(2 * time.Second)
	changedAt := collectedAt.Add(-3 * time.Second)
	event := BuildOddsUpdatedEvent("8xbet", "8xbet", "default", []models.OddsQuote{
		{
			BookmakerID:    "8xbet",
			LobbyID:        "default",
			FixtureID:      "fixture-1",
			MarketID:       "hdp-ah",
			OutcomeID:      "outcome-1",
			Odds:           -0.85,
			Suspended:      true,
			CollectedAt:    collectedAt,
			LastObservedAt: observedAt,
			ChangedAt:      changedAt,
		},
	})

	if len(event.Payload.Quotes) != 1 {
		t.Fatalf("expected one quote, got %d", len(event.Payload.Quotes))
	}
	quote := event.Payload.Quotes[0]
	if !quote.Suspended {
		t.Fatal("expected suspended state in realtime quote payload")
	}
	if quote.CollectedAt != collectedAt {
		t.Fatalf("expected collected_at %s, got %s", collectedAt, quote.CollectedAt)
	}
	if quote.LastObservedAt != observedAt {
		t.Fatalf("expected last_observed_at %s, got %s", observedAt, quote.LastObservedAt)
	}
	if quote.ChangedAt != changedAt {
		t.Fatalf("expected changed_at %s, got %s", changedAt, quote.ChangedAt)
	}
}
