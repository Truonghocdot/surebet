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
