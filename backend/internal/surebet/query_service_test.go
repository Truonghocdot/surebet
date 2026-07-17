package surebet

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"surebet/backend/internal/models"
)

type countingOddsReader struct {
	calls atomic.Int32
}

func (r *countingOddsReader) ListCurrentDetectorCandidatesBySource(
	context.Context,
	time.Time,
) ([]models.OddsQuote, error) {
	r.calls.Add(1)
	time.Sleep(20 * time.Millisecond)
	return []models.OddsQuote{{FixtureID: "fixture-a"}}, nil
}

type countingDetector struct {
	calls atomic.Int32
}

func (d *countingDetector) Detect(
	context.Context,
	[]models.OddsQuote,
) ([]models.SurebetOpportunity, error) {
	d.calls.Add(1)
	return []models.SurebetOpportunity{{ID: "surebet-a", FixtureID: "fixture-a"}}, nil
}

func TestQueryServiceSharesDetectorRunAcrossConcurrentRequests(t *testing.T) {
	reader := &countingOddsReader{}
	detector := &countingDetector{}
	service := NewQueryService(reader, detector)

	const requestCount = 20
	var wait sync.WaitGroup
	wait.Add(requestCount)
	for range requestCount {
		go func() {
			defer wait.Done()
			items, err := service.ListCurrentSurebets(context.Background())
			if err != nil {
				t.Errorf("list current surebets: %v", err)
				return
			}
			if len(items) != 1 || items[0].ID != "surebet-a" {
				t.Errorf("unexpected surebet result: %+v", items)
			}
		}()
	}
	wait.Wait()

	if calls := reader.calls.Load(); calls != 1 {
		t.Fatalf("expected one repository read, got %d", calls)
	}
	if calls := detector.calls.Load(); calls != 1 {
		t.Fatalf("expected one detector run, got %d", calls)
	}

	service.Trigger()
	if _, err := service.ListCurrentSurebets(context.Background()); err != nil {
		t.Fatalf("list after invalidation: %v", err)
	}
	if calls := detector.calls.Load(); calls != 2 {
		t.Fatalf("expected detector rerun after invalidation, got %d", calls)
	}
}
