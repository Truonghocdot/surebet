package surebet

import (
	"context"
	"sync"
	"testing"
	"time"

	"surebet/backend/internal/config"
	"surebet/backend/internal/dto"
	"surebet/backend/internal/realtime"
)

func TestVerificationServicePublishesCandidateOnce(t *testing.T) {
	candidate := confirmationCandidate()
	candidate.ExpiresAt = time.Now().UTC().Add(time.Minute)
	broadcaster := &verificationBroadcasterStub{}
	service := NewVerificationService(
		config.TelegramConfig{},
		nil,
		nil,
		&verificationStoreStub{},
		nil,
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
		nil,
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
	confirmed.Legs[1].Odds = 0.96
	confirmed.ConfirmedAt = time.Now().UTC()
	confirmed.ValidUntil = confirmed.ConfirmedAt.Add(2 * time.Second)
	started := make(chan struct{})
	release := make(chan struct{})
	store := &verificationStoreStub{}
	notifier := &verificationNotifierStub{}
	service := NewVerificationService(
		config.TelegramConfig{VerificationMode: "strict"},
		confirmationReaderStub{items: []dto.SurebetView{candidate}},
		verificationConfirmerStub{item: confirmed, started: started, release: release},
		store,
		notifier,
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
	if notifier.Count() != 0 {
		t.Fatal("changed quote must not enqueue a Telegram notification")
	}
	if store.Deleted() != candidate.ID {
		t.Fatalf("changed quote must delete verified snapshot, got %q", store.Deleted())
	}
}

func TestVerificationServiceAcceptsHardConfirmDeltaThatRemainsCurrent(t *testing.T) {
	candidate := confirmationCandidate()
	candidate.Legs[0].Odds = -0.92
	candidate.Legs[1].Odds = 0.96
	confirmed := cloneSurebetView(candidate)
	confirmed.VerificationStatus = "confirmed"
	confirmed.ConfirmedAt = time.Now().UTC()
	confirmed.ValidUntil = confirmed.ConfirmedAt.Add(2 * time.Second)
	started := make(chan struct{})
	release := make(chan struct{})
	store := &verificationStoreStub{}
	notifier := &verificationNotifierStub{}
	service := NewVerificationService(
		config.TelegramConfig{VerificationMode: "strict"},
		confirmationReaderStub{items: []dto.SurebetView{candidate}},
		verificationConfirmerStub{item: confirmed, started: started, release: release},
		store,
		notifier,
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
	if notifier.Count() != 1 {
		t.Fatal("hard-confirm delta with the same current odds must remain actionable")
	}
}

type verificationConfirmerStub struct {
	item    dto.SurebetView
	started chan struct{}
	release chan struct{}
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

type verificationNotifierStub struct {
	mu    sync.Mutex
	count int
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

func (s *verificationNotifierStub) NotifyConfirmed(context.Context, dto.SurebetView) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.count++
	return nil
}

func (s *verificationNotifierStub) Count() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.count
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
