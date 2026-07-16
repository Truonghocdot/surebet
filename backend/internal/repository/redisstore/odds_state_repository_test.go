package redisstore

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"

	"surebet/backend/internal/dto"
)

func TestOddsStateRepositoryQuoteUpsertIsIdempotent(t *testing.T) {
	repo, cleanup := newTestOddsStateRepository(t)
	defer cleanup()

	event := testQuoteUpsertEvent("fixture-a", "market-a", "outcome-a", time.Now().UTC())

	changed, _, err := repo.ApplyQuoteUpsert(context.Background(), event)
	if err != nil {
		t.Fatalf("apply first upsert: %v", err)
	}
	if !changed {
		t.Fatal("expected first upsert to change state")
	}

	changed, _, err = repo.ApplyQuoteUpsert(context.Background(), event)
	if err != nil {
		t.Fatalf("apply second upsert: %v", err)
	}
	if changed {
		t.Fatal("expected identical upsert to be ignored")
	}

	items, err := repo.ListCurrent(context.Background(), "jun88", "cmd", "")
	if err != nil {
		t.Fatalf("list current: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected exactly one current quote, got %d", len(items))
	}
}

func TestOddsStateRepositoryRepeatedObservationDoesNotAppendHistory(t *testing.T) {
	repo, cleanup := newTestOddsStateRepository(t)
	defer cleanup()

	initialAt := time.Date(2026, 7, 16, 10, 0, 0, 0, time.UTC)
	event := testQuoteUpsertEvent("fixture-observed", "market-a", "outcome-a", initialAt)
	if changed, _, err := repo.ApplyQuoteUpsert(context.Background(), event); err != nil || !changed {
		t.Fatalf("apply initial upsert: changed=%v err=%v", changed, err)
	}

	event.OccurredAt = initialAt.Add(20 * time.Second)
	changed, observed, err := repo.ApplyQuoteUpsert(context.Background(), event)
	if err != nil {
		t.Fatalf("apply repeated observation: %v", err)
	}
	if changed {
		t.Fatal("expected repeated observation not to change quote state")
	}
	if !observed.LastObservedAt.Equal(event.OccurredAt) {
		t.Fatalf("expected last observed at %s, got %s", event.OccurredAt, observed.LastObservedAt)
	}
	if !observed.ChangedAt.Equal(initialAt) {
		t.Fatalf("expected changed at to remain %s, got %s", initialAt, observed.ChangedAt)
	}

	history, err := repo.ListByFixture(context.Background(), "fixture-observed")
	if err != nil {
		t.Fatalf("list fixture history: %v", err)
	}
	if len(history) != 1 {
		t.Fatalf("expected one history record after observation-only update, got %d", len(history))
	}
}

func TestOddsStateRepositoryBatchObservationDoesNotReportChanges(t *testing.T) {
	repo, cleanup := newTestOddsStateRepository(t)
	defer cleanup()

	initialAt := time.Date(2026, 7, 16, 10, 0, 0, 0, time.UTC)
	event := testQuoteUpsertEvent("fixture-batch", "market-a", "outcome-a", initialAt)
	if changed, err := repo.ApplyQuoteUpsertBatch(context.Background(), []dto.CollectorStreamQuoteUpsert{event}); err != nil || len(changed) != 1 {
		t.Fatalf("apply initial batch: changed=%d err=%v", len(changed), err)
	}

	event.OccurredAt = initialAt.Add(30 * time.Second)
	changed, err := repo.ApplyQuoteUpsertBatch(context.Background(), []dto.CollectorStreamQuoteUpsert{event})
	if err != nil {
		t.Fatalf("apply observation batch: %v", err)
	}
	if len(changed) != 0 {
		t.Fatalf("expected observation batch to report no state changes, got %d", len(changed))
	}

	history, err := repo.ListByFixture(context.Background(), "fixture-batch")
	if err != nil {
		t.Fatalf("list batch fixture history: %v", err)
	}
	if len(history) != 1 {
		t.Fatalf("expected one batch history record, got %d", len(history))
	}
}

func TestOddsStateRepositoryQuoteRemoveSuspendsCurrentQuote(t *testing.T) {
	repo, cleanup := newTestOddsStateRepository(t)
	defer cleanup()

	upsert := testQuoteUpsertEvent("fixture-a", "market-a", "outcome-a", time.Now().UTC())
	if _, _, err := repo.ApplyQuoteUpsert(context.Background(), upsert); err != nil {
		t.Fatalf("seed quote: %v", err)
	}

	remove := testQuoteRemoveEvent(upsert, upsert.OccurredAt.Add(5*time.Second))
	changed, quote, err := repo.ApplyQuoteRemove(context.Background(), remove)
	if err != nil {
		t.Fatalf("remove quote: %v", err)
	}
	if !changed {
		t.Fatal("expected remove event to suspend current quote")
	}
	if !quote.Suspended {
		t.Fatal("expected removed quote to become suspended")
	}

	items, err := repo.ListCurrent(context.Background(), "jun88", "cmd", "")
	if err != nil {
		t.Fatalf("list current after remove: %v", err)
	}
	if len(items) != 1 || !items[0].Suspended {
		t.Fatalf("expected suspended quote to remain in current view, got %+v", items)
	}

	live, err := repo.ListCurrentLive(context.Background(), "jun88", "cmd", "")
	if err != nil {
		t.Fatalf("list current live after remove: %v", err)
	}
	if len(live) != 0 {
		t.Fatalf("expected suspended quote to be excluded from live view, got %+v", live)
	}
}

func TestOddsStateRepositorySnapshotCommitSuspendsMissingQuotes(t *testing.T) {
	repo, cleanup := newTestOddsStateRepository(t)
	defer cleanup()

	first := testQuoteUpsertEvent("fixture-a", "market-a", "outcome-a", time.Date(2026, 7, 16, 10, 0, 0, 0, time.UTC))
	second := testQuoteUpsertEvent("fixture-b", "market-b", "outcome-b", time.Date(2026, 7, 16, 10, 0, 1, 0, time.UTC))
	if _, _, err := repo.ApplyQuoteUpsert(context.Background(), first); err != nil {
		t.Fatalf("seed first quote: %v", err)
	}
	if _, _, err := repo.ApplyQuoteUpsert(context.Background(), second); err != nil {
		t.Fatalf("seed second quote: %v", err)
	}

	snapshotID := "snapshot-1"
	sessionID := "session-1"
	source := testSource()
	if err := repo.BeginSnapshot(context.Background(), source, sessionID, snapshotID); err != nil {
		t.Fatalf("begin snapshot: %v", err)
	}

	first.SnapshotID = snapshotID
	first.SessionID = sessionID
	first.OccurredAt = first.OccurredAt.Add(10 * time.Second)
	if _, _, err := repo.ApplyQuoteUpsert(context.Background(), first); err != nil {
		t.Fatalf("apply snapshot upsert: %v", err)
	}

	changed, err := repo.CommitSnapshot(context.Background(), source, sessionID, dto.CollectorStreamSnapshotCommit{
		Type:          "snapshot_commit",
		SessionID:     sessionID,
		SnapshotID:    snapshotID,
		Seq:           2,
		SentAt:        first.OccurredAt.Add(1 * time.Second),
		ExpectedCount: 1,
	})
	if err != nil {
		t.Fatalf("commit snapshot: %v", err)
	}
	if len(changed) != 1 || changed[0].FixtureID != "fixture-b" || !changed[0].Suspended {
		t.Fatalf("expected missing quote to be suspended on commit, got %+v", changed)
	}
}

func TestOddsStateRepositoryHistoryKeepsShortFixtureLog(t *testing.T) {
	repo, cleanup := newTestOddsStateRepository(t)
	defer cleanup()

	event := testQuoteUpsertEvent("fixture-history", "market-a", "outcome-a", time.Date(2026, 7, 16, 10, 0, 0, 0, time.UTC))
	if _, _, err := repo.ApplyQuoteUpsert(context.Background(), event); err != nil {
		t.Fatalf("apply upsert: %v", err)
	}

	items, err := repo.ListByFixture(context.Background(), "fixture-history")
	if err != nil {
		t.Fatalf("list fixture history: %v", err)
	}
	if len(items) != 1 || items[0].FixtureID != "fixture-history" {
		t.Fatalf("expected fixture history to contain stored quote, got %+v", items)
	}
}

func TestOddsStateRepositoryJanitorPrunesExpiredQuotes(t *testing.T) {
	repo, cleanup := newTestOddsStateRepository(t)
	defer cleanup()

	base := time.Now().UTC()
	oldFinished := testQuoteUpsertEvent("fixture-old", "market-a", "outcome-a", base.Add(-2*time.Hour))
	oldFinished.Quote.MatchState = "finished"
	if _, _, err := repo.ApplyQuoteUpsert(context.Background(), oldFinished); err != nil {
		t.Fatalf("seed old finished quote: %v", err)
	}

	fresh := testQuoteUpsertEvent("fixture-fresh", "market-b", "outcome-b", base)
	if _, _, err := repo.ApplyQuoteUpsert(context.Background(), fresh); err != nil {
		t.Fatalf("seed fresh quote: %v", err)
	}

	if err := repo.pruneExpired(context.Background(), base.Add(31*time.Minute)); err != nil {
		t.Fatalf("prune expired: %v", err)
	}

	items, err := repo.ListCurrent(context.Background(), "jun88", "cmd", "")
	if err != nil {
		t.Fatalf("list current after prune: %v", err)
	}
	if len(items) != 1 || items[0].FixtureID != "fixture-fresh" {
		t.Fatalf("expected janitor to keep only fresh quote, got %+v", items)
	}
}

func newTestOddsStateRepository(t *testing.T) (*OddsStateRepository, func()) {
	t.Helper()

	server := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: server.Addr()})
	repo := NewOddsStateRepository(client)

	return repo, func() {
		_ = client.Close()
		server.Close()
	}
}

func testSource() dto.CollectorSource {
	return dto.CollectorSource{
		CollectorID: "jun88-cmd",
		BookmakerID: "jun88",
		LobbyID:     "cmd",
	}
}

func testQuoteUpsertEvent(
	fixtureID, marketID, outcomeID string,
	occurredAt time.Time,
) dto.CollectorStreamQuoteUpsert {
	return dto.CollectorStreamQuoteUpsert{
		Type:       "quote_upsert",
		SessionID:  "session-1",
		Seq:        1,
		OccurredAt: occurredAt,
		Source:     testSource(),
		RawIDs: dto.CollectorStreamRawIDs{
			FixtureID: fixtureID,
			MarketID:  marketID,
			OutcomeID: outcomeID,
		},
		Markers: dto.CollectorStreamMarkers{
			FixtureMarker: fixtureID + "-marker",
			MarketMarker:  "handicap",
			OutcomeMarker: outcomeID + "-marker",
		},
		Quote: dto.CollectorStreamQuote{
			Sport:          "football",
			HomeTeam:       fixtureID + "-home",
			AwayTeam:       fixtureID + "-away",
			LeagueName:     "League",
			MatchState:     "live",
			EventStartAt:   occurredAt.Format(time.RFC3339),
			OutcomeName:    "Outcome " + outcomeID,
			Odds:           0.95,
			AvailableStake: 100,
			Suspended:      false,
		},
	}
}

func testQuoteRemoveEvent(
	upsert dto.CollectorStreamQuoteUpsert,
	occurredAt time.Time,
) dto.CollectorStreamQuoteRemove {
	return dto.CollectorStreamQuoteRemove{
		Type:       "quote_remove",
		SessionID:  upsert.SessionID,
		SnapshotID: upsert.SnapshotID,
		Seq:        upsert.Seq + 1,
		OccurredAt: occurredAt,
		Source:     upsert.Source,
		RawIDs:     upsert.RawIDs,
		Markers:    upsert.Markers,
	}
}
