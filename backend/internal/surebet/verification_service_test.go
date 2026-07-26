package surebet

import (
	"context"
	"sync"
	"testing"
	"time"

	"surebet/backend/internal/config"
	"surebet/backend/internal/dto"
	"surebet/backend/internal/models"
	"surebet/backend/internal/realtime"
)

func TestVerificationTriggerDoesNotBlockCollectorIngest(t *testing.T) {
	store := &blockingVerificationStore{
		started: make(chan struct{}),
		release: make(chan struct{}),
	}
	service := NewVerificationService(
		config.TelegramConfig{},
		confirmationReaderStub{items: nil},
		nil,
		store,
		nil,
		nil,
		nil,
	)

	startedAt := time.Now()
	service.Trigger([]models.OddsQuote{{
		BookmakerID: "8xbet",
		LobbyID:     "default",
		FixtureID:   "fixture-1",
	}})
	if elapsed := time.Since(startedAt); elapsed > 100*time.Millisecond {
		t.Fatalf("verification trigger blocked ingest for %s", elapsed)
	}

	select {
	case <-store.started:
	case <-time.After(time.Second):
		t.Fatal("verification worker did not start invalidation")
	}
	close(store.release)
}

func TestVerificationCandidateAttemptsAreRateLimitedByFingerprint(t *testing.T) {
	service := NewVerificationService(
		config.TelegramConfig{}, nil, nil, nil, nil, nil, nil,
	)
	candidate := confirmationCandidate()
	now := time.Now()

	if !service.reserveVerification(candidate, now) {
		t.Fatal("first candidate observation must be verified")
	}
	if service.reserveVerification(candidate, now.Add(time.Second)) {
		t.Fatal("unchanged candidate must not be verified for every observation refresh")
	}

	changed := cloneSurebetView(candidate)
	changed.Legs[0].Odds += 0.01
	if service.reserveVerification(changed, now.Add(2*time.Second)) {
		t.Fatal("changed candidate must respect the short verification cooldown")
	}
	if !service.reserveVerification(changed, now.Add(6*time.Second)) {
		t.Fatal("changed candidate must be verified after its cooldown")
	}
	if service.reserveVerification(changed, now.Add(20*time.Second)) {
		t.Fatal("unchanged fingerprint must respect the retry interval")
	}
	if !service.reserveVerification(changed, now.Add(37*time.Second)) {
		t.Fatal("unchanged fingerprint must be retried after the retry interval")
	}
}

func TestVerificationSkipsHardConfirmationWhenSuppressed(t *testing.T) {
	candidate := confirmationCandidate()
	confirmer := &countingVerificationConfirmer{item: candidate}
	service := NewVerificationService(
		config.TelegramConfig{VerificationMode: "suppressed"},
		confirmationReaderStub{items: []dto.SurebetView{candidate}},
		confirmer,
		&verificationStoreStub{},
		nil,
		nil,
		nil,
	)
	refs := refsForOpportunity(candidate)
	if err := service.process(context.Background(), refs, map[string]uint64{}); err != nil {
		t.Fatalf("process suppressed verification: %v", err)
	}
	if confirmer.Count() != 0 {
		t.Fatal("suppressed verification must not call collectors")
	}
}

func TestVerificationServicePublishesCandidateOnce(t *testing.T) {
	candidate := confirmationCandidate()
	candidate.ExpiresAt = time.Now().UTC().Add(time.Minute)
	broadcaster := &verificationBroadcasterStub{}
	service := NewVerificationService(
		config.TelegramConfig{},
		nil,
		nil,
		&verificationStoreStub{},
		broadcaster,
		nil,
		nil,
	)

	service.publishCandidate(candidate)
	service.publishCandidate(candidate)

	events := broadcaster.Events()
	if len(events) != 1 {
		t.Fatalf("expected one candidate event, got %d", len(events))
	}
	if events[0].Type != "surebet_candidate_detected" {
		t.Fatalf("expected candidate event type, got %q", events[0].Type)
	}
	item, ok := events[0].Payload.(dto.SurebetView)
	if !ok || item.ID != candidate.ID {
		t.Fatalf("expected candidate payload for %q, got %#v", candidate.ID, events[0].Payload)
	}
}

func TestVerificationServiceDoesNotPublishExpiredOrAmbiguousCandidate(t *testing.T) {
	candidate := confirmationCandidate()
	broadcaster := &verificationBroadcasterStub{}
	service := NewVerificationService(
		config.TelegramConfig{},
		nil,
		nil,
		&verificationStoreStub{},
		broadcaster,
		nil,
		nil,
	)

	candidate.ExpiresAt = time.Now().UTC().Add(-time.Second)
	service.publishCandidate(candidate)
	candidate.ExpiresAt = time.Now().UTC().Add(time.Minute)
	candidate.MatchAmbiguous = true
	service.publishCandidate(candidate)

	if events := broadcaster.Events(); len(events) != 0 {
		t.Fatalf("expected no candidate events, got %d", len(events))
	}
}

func TestVerificationServiceRejectsQuoteChangedDuringConfirmation(t *testing.T) {
	candidate := confirmationCandidate()
	confirmed := cloneSurebetView(candidate)
	confirmed.VerificationStatus = "confirmed"
	confirmed.Legs[0].Odds = -0.92
	confirmed.Legs[1].Odds = -0.88
	confirmed.ConfirmedAt = time.Now().UTC()
	confirmed.ValidUntil = confirmed.ConfirmedAt.Add(2 * time.Second)
	started := make(chan struct{})
	release := make(chan struct{})
	store := &verificationStoreStub{}
	service := NewVerificationService(
		config.TelegramConfig{VerificationMode: "strict"},
		confirmationReaderStub{items: []dto.SurebetView{candidate}},
		verificationConfirmerStub{item: confirmed, started: started, release: release},
		store,
		nil,
		nil,
		nil,
	)
	refs := refsForOpportunity(candidate)
	versions := make(map[string]uint64)
	service.mu.Lock()
	for _, ref := range refs {
		key := fixtureRefKey(ref)
		service.generations[key] = 1
		versions[key] = 1
	}
	service.mu.Unlock()

	done := make(chan error, 1)
	go func() {
		done <- service.process(context.Background(), refs, versions)
	}()
	<-started
	service.mu.Lock()
	service.generations[fixtureRefKey(refs[0])]++
	service.mu.Unlock()
	close(release)
	if err := <-done; err != nil {
		t.Fatalf("process verification: %v", err)
	}
	if store.Deleted() != candidate.ID {
		t.Fatalf("changed quote must delete verified snapshot, got %q", store.Deleted())
	}
}

func TestVerificationServiceAcceptsHardConfirmDeltaThatRemainsCurrent(t *testing.T) {
	candidate := confirmationCandidate()
	candidate.Legs[0].Odds = -0.92
	candidate.Legs[1].Odds = -0.88
	confirmed := cloneSurebetView(candidate)
	confirmed.VerificationStatus = "confirmed"
	confirmed.ConfirmedAt = time.Now().UTC()
	confirmed.ValidUntil = confirmed.ConfirmedAt.Add(2 * time.Second)
	started := make(chan struct{})
	release := make(chan struct{})
	store := &verificationStoreStub{}
	broadcaster := &verificationBroadcasterStub{}
	service := NewVerificationService(
		config.TelegramConfig{VerificationMode: "strict"},
		confirmationReaderStub{items: []dto.SurebetView{candidate}},
		verificationConfirmerStub{item: confirmed, started: started, release: release},
		store,
		broadcaster,
		nil,
		nil,
	)
	refs := refsForOpportunity(candidate)
	versions := make(map[string]uint64)
	service.mu.Lock()
	for _, ref := range refs {
		key := fixtureRefKey(ref)
		service.generations[key] = 1
		versions[key] = 1
	}
	service.mu.Unlock()

	done := make(chan error, 1)
	go func() {
		done <- service.process(context.Background(), refs, versions)
	}()
	<-started
	service.mu.Lock()
	service.generations[fixtureRefKey(refs[0])]++
	service.mu.Unlock()
	close(release)
	if err := <-done; err != nil {
		t.Fatalf("process verification: %v", err)
	}
	confirmedPublished := false
	for _, event := range broadcaster.Events() {
		payload, ok := event.Payload.(dto.SurebetVerificationEvent)
		if event.Type == "surebet_verification_updated" && ok && payload.Status == "confirmed" {
			confirmedPublished = true
			break
		}
	}
	if !confirmedPublished {
		t.Fatal("hard-confirm delta with the same current odds must remain actionable")
	}
}

type verificationConfirmerStub struct {
	item    dto.SurebetView
	started chan struct{}
	release chan struct{}
}

type countingVerificationConfirmer struct {
	mu    sync.Mutex
	item  dto.SurebetView
	count int
}

func (s *countingVerificationConfirmer) ConfirmCurrentSurebet(
	context.Context,
	string,
) (dto.SurebetView, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.count++
	return s.item, true, nil
}

func (s *countingVerificationConfirmer) Count() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.count
}

func (s verificationConfirmerStub) ConfirmCurrentSurebet(
	context.Context,
	string,
) (dto.SurebetView, bool, error) {
	close(s.started)
	<-s.release
	return s.item, true, nil
}

type verificationStoreStub struct {
	mu      sync.Mutex
	deleted string
}

type blockingVerificationStore struct {
	verificationStoreStub
	started chan struct{}
	release chan struct{}
}

func (s *blockingVerificationStore) InvalidateFixtures(
	context.Context,
	[]dto.VerifiedFixtureRef,
) ([]string, error) {
	close(s.started)
	<-s.release
	return nil, nil
}

func (s *verificationStoreStub) Get(context.Context, string) (dto.SurebetView, bool, error) {
	return dto.SurebetView{}, false, nil
}

func (s *verificationStoreStub) List(context.Context) ([]dto.SurebetView, error) {
	return nil, nil
}

func (s *verificationStoreStub) InvalidateFixtures(
	context.Context,
	[]dto.VerifiedFixtureRef,
) ([]string, error) {
	return nil, nil
}

func (s *verificationStoreStub) Delete(_ context.Context, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.deleted = id
	return nil
}

func (s *verificationStoreStub) RecordVerification(
	context.Context,
	bool,
	time.Duration,
	bool,
	bool,
) error {
	return nil
}

func (s *verificationStoreStub) RolloutSnapshot(context.Context) (dto.VerificationRolloutSnapshot, error) {
	return dto.VerificationRolloutSnapshot{}, nil
}

func (s *verificationStoreStub) SetRolloutMode(context.Context, string) error {
	return nil
}

func (s *verificationStoreStub) Deleted() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.deleted
}

type verificationBroadcasterStub struct {
	mu     sync.Mutex
	events []realtime.Event
}

func (s *verificationBroadcasterStub) Broadcast(event realtime.Event) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.events = append(s.events, event)
}

func (s *verificationBroadcasterStub) Events() []realtime.Event {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]realtime.Event(nil), s.events...)
}

func refsForOpportunity(item dto.SurebetView) []dto.VerifiedFixtureRef {
	result := make([]dto.VerifiedFixtureRef, 0, len(item.Legs))
	for _, leg := range item.Legs {
		result = append(result, dto.VerifiedFixtureRef{
			BookmakerID: leg.BookmakerID,
			LobbyID:     leg.LobbyID,
			FixtureID:   leg.FixtureID,
		})
	}
	return result
}
