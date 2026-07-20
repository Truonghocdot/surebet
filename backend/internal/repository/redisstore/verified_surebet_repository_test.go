package redisstore

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"

	"surebet/backend/internal/dto"
)

func TestVerifiedSurebetRepositoryExpiresAndInvalidatesByFixture(t *testing.T) {
	server := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: server.Addr()})
	t.Cleanup(func() {
		_ = client.Close()
		server.Close()
	})
	repository := NewVerifiedSurebetRepository(client)
	now := time.Now().UTC()
	item := dto.SurebetView{
		ID:                 "opportunity-a",
		VerificationStatus: "confirmed",
		ConfirmedAt:        now,
		ValidUntil:         now.Add(2 * time.Second),
		Legs: []dto.SurebetLegView{
			{BookmakerID: "8xbet", LobbyID: "default", FixtureID: "fixture-8x"},
			{BookmakerID: "jun88", LobbyID: "cmd", FixtureID: "fixture-cmd"},
		},
	}
	ctx := context.Background()
	if err := repository.Put(ctx, item, 2*time.Second); err != nil {
		t.Fatalf("put verified surebet: %v", err)
	}
	if current, found, err := repository.Get(ctx, item.ID); err != nil || !found || current.ID != item.ID {
		t.Fatalf("get verified surebet: found=%t item=%+v err=%v", found, current, err)
	}

	invalidated, err := repository.InvalidateFixtures(ctx, []dto.VerifiedFixtureRef{
		{BookmakerID: "8xbet", LobbyID: "default", FixtureID: "fixture-8x"},
	})
	if err != nil || len(invalidated) != 1 || invalidated[0] != item.ID {
		t.Fatalf("invalidate verified surebet: ids=%+v err=%v", invalidated, err)
	}
	if _, found, err := repository.Get(ctx, item.ID); err != nil || found {
		t.Fatalf("invalidated surebet must be absent: found=%t err=%v", found, err)
	}

	if err := repository.Put(ctx, item, 2*time.Second); err != nil {
		t.Fatalf("put verified surebet for expiry: %v", err)
	}
	server.FastForward(3 * time.Second)
	if _, found, err := repository.Get(ctx, item.ID); err != nil || found {
		t.Fatalf("expired surebet must be absent: found=%t err=%v", found, err)
	}
}

func TestVerifiedSurebetRepositoryRecordsRolloutCounters(t *testing.T) {
	server := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: server.Addr()})
	t.Cleanup(func() {
		_ = client.Close()
		server.Close()
	})
	repository := NewVerifiedSurebetRepository(client)
	ctx := context.Background()
	if err := repository.RecordVerification(ctx, true, 120*time.Millisecond, false, false); err != nil {
		t.Fatalf("record confirmed verification: %v", err)
	}
	if err := repository.RecordVerification(ctx, false, 350*time.Millisecond, true, true); err != nil {
		t.Fatalf("record failed verification: %v", err)
	}
	snapshot, err := repository.RolloutSnapshot(ctx)
	if err != nil {
		t.Fatalf("load rollout snapshot: %v", err)
	}
	if snapshot.CandidateTotal != 2 || snapshot.ConfirmedTotal != 1 ||
		snapshot.ErrorTotal != 1 || snapshot.ParserErrorTotal != 1 ||
		snapshot.ConsecutiveErrors != 1 || len(snapshot.Latencies) != 2 {
		t.Fatalf("unexpected rollout snapshot: %+v", snapshot)
	}
}
