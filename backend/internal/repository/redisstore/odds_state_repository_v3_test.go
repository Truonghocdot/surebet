package redisstore

import (
	"context"
	"strconv"
	"testing"
	"time"

	"surebet/backend/internal/dto"
)

func TestFixtureMarketSnapshotAtomicallyReplacesLineAndRejectsOlderBatch(t *testing.T) {
	repo, cleanup := newTestOddsStateRepository(t)
	defer cleanup()
	repo.SetStateProtocol("v2")

	first := testFixtureMarketSnapshot(time.Now().UTC(), 10, "batch-10", "0.5")
	quotes, err := repo.ApplyFixtureMarketSnapshot(context.Background(), first)
	if err != nil || len(quotes) != 2 {
		t.Fatalf("apply first fixture snapshot: quotes=%d err=%v", len(quotes), err)
	}

	older := testFixtureMarketSnapshot(first.ObservedAt.Add(time.Second), 9, "batch-9", "1")
	if quotes, err := repo.ApplyFixtureMarketSnapshot(context.Background(), older); err != nil || len(quotes) != 0 {
		t.Fatalf("older batch must be ignored: quotes=%d err=%v", len(quotes), err)
	}

	changed := testFixtureMarketSnapshot(first.ObservedAt.Add(time.Second), 11, "batch-11", "1")
	quotes, err = repo.ApplyFixtureMarketSnapshot(context.Background(), changed)
	if err != nil {
		t.Fatalf("replace fixture line: %v", err)
	}
	if len(quotes) != 4 {
		t.Fatalf("expected two new and two suspended removal quotes, got %d", len(quotes))
	}

	items, err := repo.ListCurrent(context.Background(), "jun88", "cmd", "")
	if err != nil {
		t.Fatalf("list coherent current state: %v", err)
	}
	if len(items) != 2 || items[0].MarketLine != "1" || items[1].MarketLine != "1" {
		t.Fatalf("expected only the replacement line in current state, got %+v", items)
	}

	metricsKey := coherentShadowMetricsKey(first.Source)
	accepted, err := repo.client.HGet(context.Background(), metricsKey, "accepted_batches").Result()
	if err != nil {
		t.Fatalf("read coherent shadow metrics: %v", err)
	}
	acceptedCount, err := strconv.Atoi(accepted)
	if err != nil || acceptedCount != 2 {
		t.Fatalf("expected two accepted non-duplicate batches, got %q (err=%v)", accepted, err)
	}
	complete, err := repo.client.HGet(context.Background(), metricsKey, "complete_batches").Result()
	if err != nil || complete != "2" {
		t.Fatalf("expected every accepted batch to be complete, got %q (err=%v)", complete, err)
	}
	windowSize, err := repo.client.ZCard(
		context.Background(),
		coherentShadowWindowKey(first.Source),
	).Result()
	if err != nil || windowSize != 2 {
		t.Fatalf("expected two samples in the 30 minute shadow window, got %d (err=%v)", windowSize, err)
	}
	firstRecordedAt, err := repo.client.HGet(
		context.Background(),
		metricsKey,
		"first_recorded_at_ms",
	).Int64()
	if err != nil || firstRecordedAt <= 0 {
		t.Fatalf("expected shadow monitoring start timestamp, got %d (err=%v)", firstRecordedAt, err)
	}
}

func TestFixtureMarketSnapshotRejectsIncompletePairWithoutChangingState(t *testing.T) {
	repo, cleanup := newTestOddsStateRepository(t)
	defer cleanup()
	repo.SetStateProtocol("v2")

	event := testFixtureMarketSnapshot(time.Now().UTC(), 1, "batch-1", "0.5")
	if _, err := repo.ApplyFixtureMarketSnapshot(context.Background(), event); err != nil {
		t.Fatalf("seed complete fixture: %v", err)
	}

	incomplete := testFixtureMarketSnapshot(event.ObservedAt.Add(time.Second), 2, "batch-2", "1")
	incomplete.Markets[0].Outcomes = incomplete.Markets[0].Outcomes[:1]
	if _, err := repo.ApplyFixtureMarketSnapshot(context.Background(), incomplete); err == nil {
		t.Fatal("expected incomplete market to be rejected")
	}

	items, err := repo.ListCurrent(context.Background(), "jun88", "cmd", "")
	if err != nil {
		t.Fatalf("list current after rejection: %v", err)
	}
	if len(items) != 2 || items[0].BatchID != "batch-1" || items[1].BatchID != "batch-1" {
		t.Fatalf("rejected batch changed current state: %+v", items)
	}
}

func TestFixtureMarketSnapshotRemovalAndExactBatchObservation(t *testing.T) {
	repo, cleanup := newTestOddsStateRepository(t)
	defer cleanup()
	repo.SetStateProtocol("v2")

	staleAt := time.Now().UTC().Add(-4 * time.Second)
	event := testFixtureMarketSnapshot(staleAt, 1, "batch-1", "0.5")
	if _, err := repo.ApplyFixtureMarketSnapshot(context.Background(), event); err != nil {
		t.Fatalf("seed stale fixture: %v", err)
	}

	wrongObservation := testFixtureObservation(time.Now().UTC(), "wrong-batch")
	if err := repo.ObserveFixtureBatches(context.Background(), wrongObservation); err != nil {
		t.Fatalf("apply wrong observation: %v", err)
	}
	if items, _ := repo.ListCurrent(context.Background(), "jun88", "cmd", ""); len(items) != 0 {
		t.Fatalf("wrong batch refreshed stale quotes: %+v", items)
	}

	observation := testFixtureObservation(time.Now().UTC(), "batch-1")
	if err := repo.ObserveFixtureBatches(context.Background(), observation); err != nil {
		t.Fatalf("refresh exact batch: %v", err)
	}
	if items, _ := repo.ListCurrent(context.Background(), "jun88", "cmd", ""); len(items) != 2 {
		t.Fatalf("exact observation did not refresh both quotes: %+v", items)
	}
	metricsKey := coherentShadowMetricsKey(event.Source)
	acceptedObservations, err := repo.client.HGet(
		context.Background(), metricsKey, "accepted_observations",
	).Int()
	if err != nil || acceptedObservations != 1 {
		t.Fatalf("expected one accepted observation, got %d (err=%v)", acceptedObservations, err)
	}
	rejectedObservations, err := repo.client.HGet(
		context.Background(), metricsKey, "rejected_observations",
	).Int()
	if err != nil || rejectedObservations != 1 {
		t.Fatalf("expected one rejected observation, got %d (err=%v)", rejectedObservations, err)
	}

	removed := testFixtureMarketSnapshot(time.Now().UTC(), 2, "batch-2", "0.5")
	removed.Markets = nil
	quotes, err := repo.ApplyFixtureMarketSnapshot(context.Background(), removed)
	if err != nil || len(quotes) != 2 || !quotes[0].Suspended || !quotes[1].Suspended {
		t.Fatalf("remove fixture market: quotes=%+v err=%v", quotes, err)
	}
	if items, _ := repo.ListCurrent(context.Background(), "jun88", "cmd", ""); len(items) != 0 {
		t.Fatalf("removed market remained current: %+v", items)
	}
}

func TestObserveFixtureBatchesRefreshesV1WhenProtocolIsV1(t *testing.T) {
	repo, cleanup := newTestOddsStateRepository(t)
	defer cleanup()
	// Production mode: reading v1 state, v2 running as shadow.
	repo.SetStateProtocol("v1")

	staleAt := time.Now().UTC().Add(-30 * time.Second)
	snapshot := testFixtureMarketSnapshot(staleAt, 1, "batch-1", "0.5")
	// 1. Seed the exact v1 counterpart, stale beyond the 25-second window.
	v1Event := testLegacyQuoteForSnapshot(snapshot, 0, staleAt)
	if changed, _, err := repo.ApplyQuoteUpsert(context.Background(), v1Event); err != nil || !changed {
		t.Fatalf("seed v1 quote: changed=%v err=%v", changed, err)
	}

	// Confirm v1 quote is stale (excluded from active matches).
	if items, _ := repo.ListCurrent(context.Background(), "jun88", "cmd", ""); len(items) != 0 {
		t.Fatalf("expected v1 quote to be stale before bridge, got %d items", len(items))
	}

	// 2. Seed a v2 fixture snapshot so coherentVersions has a fingerprint.
	if _, err := repo.ApplyFixtureMarketSnapshot(context.Background(), snapshot); err != nil {
		t.Fatalf("seed v2 fixture snapshot: %v", err)
	}

	// 3. Fire a fixture_observed_batch with matching fingerprint.
	observation := testFixtureObservation(time.Now().UTC(), "batch-1")
	if err := repo.ObserveFixtureBatches(context.Background(), observation); err != nil {
		t.Fatalf("observe fixture batch: %v", err)
	}

	// 4. v1 quote should now be refreshed and no longer stale.
	items, err := repo.ListCurrent(context.Background(), "jun88", "cmd", "")
	if err != nil {
		t.Fatalf("list current after bridge refresh: %v", err)
	}
	v1Refreshed := 0
	for _, item := range items {
		if item.ProtocolVersion == 1 && item.FixtureID == "fixture-v2" {
			v1Refreshed++
			if !item.LastObservedAt.Equal(observation.ObservedAt.UTC()) {
				t.Fatalf("expected v1 LastObservedAt=%s, got %s",
					observation.ObservedAt.UTC(), item.LastObservedAt)
			}
			if !item.CollectedAt.Equal(observation.ObservedAt.UTC()) {
				t.Fatalf("expected v1 CollectedAt=%s, got %s",
					observation.ObservedAt.UTC(), item.CollectedAt)
			}
			if !item.ChangedAt.Equal(staleAt) {
				t.Fatalf("observation bridge changed state timestamp: got %s, want %s",
					item.ChangedAt, staleAt)
			}
		}
	}
	if v1Refreshed == 0 {
		t.Fatal("bridge did not refresh any v1 quotes")
	}
	bridged, err := repo.client.HGet(
		context.Background(),
		coherentShadowMetricsKey(snapshot.Source),
		"legacy_bridge_quotes",
	).Int()
	if err != nil || bridged != 1 {
		t.Fatalf("expected one bridged v1 quote metric, got %d (err=%v)", bridged, err)
	}
}

func TestObserveFixtureBatchesDoesNotRefreshV1WhenProtocolIsV2(t *testing.T) {
	repo, cleanup := newTestOddsStateRepository(t)
	defer cleanup()
	// V2 active: bridge should be disabled.
	repo.SetStateProtocol("v2")

	staleAt := time.Now().UTC().Add(-30 * time.Second)
	snapshot := testFixtureMarketSnapshot(staleAt, 1, "batch-1", "0.5")
	v1Event := testLegacyQuoteForSnapshot(snapshot, 0, staleAt)
	if changed, _, err := repo.ApplyQuoteUpsert(context.Background(), v1Event); err != nil || !changed {
		t.Fatalf("seed v1 quote: changed=%v err=%v", changed, err)
	}

	if _, err := repo.ApplyFixtureMarketSnapshot(context.Background(), snapshot); err != nil {
		t.Fatalf("seed v2 fixture snapshot: %v", err)
	}

	observation := testFixtureObservation(time.Now().UTC(), "batch-1")
	if err := repo.ObserveFixtureBatches(context.Background(), observation); err != nil {
		t.Fatalf("observe fixture batch: %v", err)
	}

	// When protocol=v2, the v1 bridge must be disabled. Check that the v1
	// current hash was NOT updated (quote still has the original staleAt).
	repo.cacheMu.RLock()
	v1Items := repo.current[currentCacheKey(v1Event.Source)]
	repo.cacheMu.RUnlock()

	for _, item := range v1Items {
		if item.FixtureID == "fixture-v2" && item.ProtocolVersion == 1 {
			if item.LastObservedAt.After(staleAt) {
				t.Fatal("v1 bridge must not refresh when protocol=v2")
			}
		}
	}
}

func TestObserveFixtureBatchesDoesNotReviveSuspendedV1Quote(t *testing.T) {
	repo, cleanup := newTestOddsStateRepository(t)
	defer cleanup()
	repo.SetStateProtocol("v1")

	now := time.Now().UTC()
	snapshot := testFixtureMarketSnapshot(now.Add(-30*time.Second), 1, "batch-1", "0.5")
	v1Event := testLegacyQuoteForSnapshot(snapshot, 0, now.Add(-30*time.Second))
	if _, _, err := repo.ApplyQuoteUpsert(context.Background(), v1Event); err != nil {
		t.Fatalf("seed v1 quote: %v", err)
	}

	// Suspend the v1 quote via remove.
	remove := testQuoteRemoveEvent(v1Event, now.Add(-25*time.Second))
	if _, _, err := repo.ApplyQuoteRemove(context.Background(), remove); err != nil {
		t.Fatalf("suspend v1 quote: %v", err)
	}

	// Seed v2 snapshot and fire observation.
	if _, err := repo.ApplyFixtureMarketSnapshot(context.Background(), snapshot); err != nil {
		t.Fatalf("seed v2 fixture snapshot: %v", err)
	}

	observation := testFixtureObservation(now, "batch-1")
	if err := repo.ObserveFixtureBatches(context.Background(), observation); err != nil {
		t.Fatalf("observe fixture batch: %v", err)
	}

	// Suspended v1 quote must NOT be refreshed by the bridge.
	repo.cacheMu.RLock()
	v1Items := repo.current[currentCacheKey(v1Event.Source)]
	repo.cacheMu.RUnlock()

	for _, item := range v1Items {
		if item.FixtureID == "fixture-v2" && item.ProtocolVersion == 1 {
			if !item.Suspended {
				t.Fatal("suspended quote should remain suspended")
			}
			if item.LastObservedAt.After(remove.OccurredAt) {
				t.Fatal("bridge must not refresh a suspended v1 quote")
			}
		}
	}
}

func TestObserveFixtureBatchesDoesNotRefreshLegacyMarketMissingFromV2(t *testing.T) {
	repo, cleanup := newTestOddsStateRepository(t)
	defer cleanup()
	repo.SetStateProtocol("v1")

	staleAt := time.Now().UTC().Add(-30 * time.Second)
	v1Event := testQuoteUpsertEvent("fixture-v2", "hdp-ah", "removed-outcome", staleAt)
	if _, _, err := repo.ApplyQuoteUpsert(context.Background(), v1Event); err != nil {
		t.Fatalf("seed removed v1 market: %v", err)
	}
	snapshot := testFixtureMarketSnapshot(staleAt, 1, "batch-1", "0.5")
	if _, err := repo.ApplyFixtureMarketSnapshot(context.Background(), snapshot); err != nil {
		t.Fatalf("seed v2 fixture snapshot: %v", err)
	}
	if err := repo.ObserveFixtureBatches(
		context.Background(),
		testFixtureObservation(time.Now().UTC(), "batch-1"),
	); err != nil {
		t.Fatalf("observe fixture batch: %v", err)
	}

	repo.cacheMu.RLock()
	legacy := repo.current[currentCacheKey(v1Event.Source)]
	repo.cacheMu.RUnlock()
	for _, quote := range legacy {
		if quote.OutcomeID == "removed-outcome" && quote.LastObservedAt.After(staleAt) {
			t.Fatal("v2 observation revived a legacy outcome missing from the coherent batch")
		}
	}
	missingCoherent, err := repo.client.HGet(
		context.Background(),
		coherentShadowMetricsKey(snapshot.Source),
		"missing_coherent_outcomes",
	).Int()
	if err != nil || missingCoherent != 1 {
		t.Fatalf("expected the legacy-only outcome to be reported, got %d (err=%v)", missingCoherent, err)
	}
}

func TestObserveFixtureBatchesDoesNotRefreshReusedOutcomeIDFromOldLine(t *testing.T) {
	repo, cleanup := newTestOddsStateRepository(t)
	defer cleanup()
	repo.SetStateProtocol("v1")

	staleAt := time.Now().UTC().Add(-30 * time.Second)
	snapshot := testFixtureMarketSnapshot(staleAt, 1, "batch-1", "0.5")
	v1Event := testLegacyQuoteForSnapshot(snapshot, 0, staleAt)
	v1Event.Quote.OutcomeName = "Home FC -1"
	if _, _, err := repo.ApplyQuoteUpsert(context.Background(), v1Event); err != nil {
		t.Fatalf("seed old-line v1 quote: %v", err)
	}
	if _, err := repo.ApplyFixtureMarketSnapshot(context.Background(), snapshot); err != nil {
		t.Fatalf("seed v2 fixture snapshot: %v", err)
	}
	if err := repo.ObserveFixtureBatches(
		context.Background(),
		testFixtureObservation(time.Now().UTC(), "batch-1"),
	); err != nil {
		t.Fatalf("observe fixture batch: %v", err)
	}

	repo.cacheMu.RLock()
	legacy := repo.current[currentCacheKey(v1Event.Source)]
	repo.cacheMu.RUnlock()
	for _, quote := range legacy {
		if quote.OutcomeID == v1Event.RawIDs.OutcomeID && quote.LastObservedAt.After(staleAt) {
			t.Fatal("v2 observation refreshed an old line which reused the active outcome ID")
		}
	}
	mismatched, err := repo.client.HGet(
		context.Background(),
		coherentShadowMetricsKey(snapshot.Source),
		"mismatched_outcomes",
	).Int()
	if err != nil || mismatched != 1 {
		t.Fatalf("expected reused outcome ID with a different line to be a shadow mismatch, got %d (err=%v)", mismatched, err)
	}
}

func TestObserveFixtureBatchesPersistsLegacyBridgeWithoutCoherentTimestampChange(t *testing.T) {
	repo, cleanup := newTestOddsStateRepository(t)
	defer cleanup()
	repo.SetStateProtocol("v1")

	now := time.Now().UTC()
	snapshot := testFixtureMarketSnapshot(now, 1, "batch-1", "0.5")
	v1Event := testLegacyQuoteForSnapshot(snapshot, 0, now.Add(-30*time.Second))
	if _, _, err := repo.ApplyQuoteUpsert(context.Background(), v1Event); err != nil {
		t.Fatalf("seed stale v1 quote: %v", err)
	}
	if _, err := repo.ApplyFixtureMarketSnapshot(context.Background(), snapshot); err != nil {
		t.Fatalf("seed current v2 snapshot: %v", err)
	}
	observation := testFixtureObservation(now, "batch-1")
	if err := repo.ObserveFixtureBatches(context.Background(), observation); err != nil {
		t.Fatalf("observe duplicate v2 timestamp: %v", err)
	}

	restarted := NewOddsStateRepository(repo.client)
	restarted.SetStateProtocol("v1")
	if err := restarted.WarmCurrentCache(context.Background()); err != nil {
		t.Fatalf("warm persisted bridge state: %v", err)
	}
	items, err := restarted.ListCurrent(context.Background(), "jun88", "cmd", "")
	if err != nil || len(items) != 1 || !items[0].LastObservedAt.Equal(now) {
		t.Fatalf("legacy bridge was not persisted: items=%+v err=%v", items, err)
	}
}

func testFixtureMarketSnapshot(
	observedAt time.Time,
	seq int64,
	batchID, line string,
) dto.CollectorStreamFixtureMarketSnapshot {
	return dto.CollectorStreamFixtureMarketSnapshot{
		Type:            "fixture_market_snapshot",
		ProtocolVersion: 2,
		SessionID:       "session-v2",
		Seq:             seq,
		BatchID:         batchID,
		Fingerprint:     "fingerprint-" + batchID,
		SourceEventID:   "provider-event-1",
		ObservedAt:      observedAt,
		Source:          testSource(),
		Fixture: dto.CollectorStreamFixture{
			FixtureID:    "fixture-v2",
			Sport:        "football",
			HomeTeam:     "Home FC",
			AwayTeam:     "Away FC",
			LeagueName:   "League",
			MatchState:   "live",
			EventStartAt: observedAt.Add(-time.Hour).Format(time.RFC3339),
		},
		Complete: true,
		Markets: []dto.CollectorStreamFixtureMarket{{
			MarketID:       "hdp-ah",
			Period:         "FT",
			NormalizedLine: line,
			Status:         "open",
			Outcomes: []dto.CollectorStreamMarketOutcome{
				{
					OutcomeID:   "home-" + line,
					OutcomeName: "Home FC -" + line,
					Side:        "home",
					Odds:        -0.85,
					RawOdds:     -0.85,
					OddsFormat:  "malay",
				},
				{
					OutcomeID:   "away-" + line,
					OutcomeName: "Away FC +" + line,
					Side:        "away",
					Odds:        0.8,
					RawOdds:     0.8,
					OddsFormat:  "malay",
				},
			},
		}},
	}
}

func testFixtureObservation(observedAt time.Time, batchID string) dto.CollectorStreamFixtureObservedBatch {
	return dto.CollectorStreamFixtureObservedBatch{
		Type:            "fixture_observed_batch",
		ProtocolVersion: 2,
		SessionID:       "session-v2",
		Seq:             20,
		ObservedAt:      observedAt,
		Source:          testSource(),
		Items: []dto.CollectorStreamFixtureObservation{{
			FixtureID:   "fixture-v2",
			BatchID:     batchID,
			Fingerprint: "fingerprint-" + batchID,
		}},
	}
}

func testLegacyQuoteForSnapshot(
	snapshot dto.CollectorStreamFixtureMarketSnapshot,
	outcomeIndex int,
	occurredAt time.Time,
) dto.CollectorStreamQuoteUpsert {
	market := snapshot.Markets[0]
	outcome := market.Outcomes[outcomeIndex]
	event := testQuoteUpsertEvent(
		snapshot.Fixture.FixtureID,
		market.MarketID,
		outcome.OutcomeID,
		occurredAt,
	)
	event.Quote.HomeTeam = snapshot.Fixture.HomeTeam
	event.Quote.AwayTeam = snapshot.Fixture.AwayTeam
	event.Quote.LeagueName = snapshot.Fixture.LeagueName
	event.Quote.OutcomeName = outcome.OutcomeName
	event.Quote.Odds = outcome.Odds
	event.Quote.Suspended = outcome.Suspended
	return event
}
