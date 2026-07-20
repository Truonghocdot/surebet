package surebet

import (
	"context"
	"math"
	"sort"
	"strings"
	"sync"
	"time"

	"surebet/backend/internal/config"
	"surebet/backend/internal/dto"
	"surebet/backend/internal/logger"
	"surebet/backend/internal/models"
	"surebet/backend/internal/realtime"
)

type HardSurebetConfirmer interface {
	ConfirmCurrentSurebet(ctx context.Context, opportunityID string) (dto.SurebetView, bool, error)
}

type VerificationStore interface {
	VerifiedOpportunityReader
	InvalidateFixtures(ctx context.Context, refs []dto.VerifiedFixtureRef) ([]string, error)
	Delete(ctx context.Context, opportunityID string) error
	RecordVerification(ctx context.Context, confirmed bool, latency time.Duration, isError, isParserError bool) error
	RolloutSnapshot(ctx context.Context) (dto.VerificationRolloutSnapshot, error)
	SetRolloutMode(ctx context.Context, mode string) error
}

type ConfirmedOpportunityNotifier interface {
	NotifyConfirmed(ctx context.Context, item dto.SurebetView) error
}

type VerificationBroadcaster interface {
	Broadcast(event realtime.Event)
}

type CollectorConnectionHealth interface {
	RequiredSourcesConnected() bool
}

type VerificationService struct {
	cfg         config.TelegramConfig
	candidates  CurrentSurebetReader
	confirmer   HardSurebetConfirmer
	store       VerificationStore
	notifier    ConfirmedOpportunityNotifier
	broadcaster VerificationBroadcaster
	health      CollectorConnectionHealth
	log         logger.Logger

	mu             sync.Mutex
	invalidationMu sync.Mutex
	pending        map[string]dto.VerifiedFixtureRef
	generations    map[string]uint64
	running        bool
	timer          *time.Timer
	lastSummaryAt  time.Time
}

func NewVerificationService(
	cfg config.TelegramConfig,
	candidates CurrentSurebetReader,
	confirmer HardSurebetConfirmer,
	store VerificationStore,
	notifier ConfirmedOpportunityNotifier,
	broadcaster VerificationBroadcaster,
	health CollectorConnectionHealth,
	log logger.Logger,
) *VerificationService {
	return &VerificationService{
		cfg: cfg, candidates: candidates, confirmer: confirmer, store: store,
		notifier: notifier, broadcaster: broadcaster, health: health, log: log,
		pending:     make(map[string]dto.VerifiedFixtureRef),
		generations: make(map[string]uint64),
	}
}

func (s *VerificationService) Trigger(quotes []models.OddsQuote) {
	if s == nil || len(quotes) == 0 {
		return
	}
	s.invalidationMu.Lock()
	defer s.invalidationMu.Unlock()

	s.mu.Lock()
	refs := make([]dto.VerifiedFixtureRef, 0, len(quotes))
	seen := make(map[string]struct{}, len(quotes))
	for _, quote := range quotes {
		ref := dto.VerifiedFixtureRef{
			BookmakerID: quote.BookmakerID,
			LobbyID:     quote.LobbyID,
			FixtureID:   quote.FixtureID,
		}
		key := fixtureRefKey(ref)
		s.pending[key] = ref
		s.generations[key]++
		if _, exists := seen[key]; !exists {
			refs = append(refs, ref)
			seen[key] = struct{}{}
		}
	}
	s.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	invalidated, err := s.store.InvalidateFixtures(ctx, refs)
	cancel()
	if err != nil {
		if s.log != nil {
			s.log.Warn("verified surebet invalidation failed", "error", err.Error())
		}
	} else {
		for _, id := range invalidated {
			s.publish(dto.SurebetVerificationEvent{
				OpportunityID: id,
				Status:        "expired",
				Reason:        "source quote changed",
			})
		}
	}

	s.mu.Lock()
	if !s.running && s.timer == nil {
		s.timer = time.AfterFunc(50*time.Millisecond, s.runPending)
	}
	s.mu.Unlock()
}

func (s *VerificationService) runPending() {
	s.mu.Lock()
	refs := make([]dto.VerifiedFixtureRef, 0, len(s.pending))
	for _, ref := range s.pending {
		refs = append(refs, ref)
	}
	s.pending = make(map[string]dto.VerifiedFixtureRef)
	generations := make(map[string]uint64, len(s.generations))
	for key, generation := range s.generations {
		generations[key] = generation
	}
	s.timer = nil
	s.running = true
	s.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	err := s.process(ctx, refs, generations)
	cancel()
	if err != nil && s.log != nil {
		s.log.Warn("surebet verification batch failed", "error", err.Error())
	}

	s.mu.Lock()
	s.running = false
	if len(s.pending) > 0 && s.timer == nil {
		s.timer = time.AfterFunc(0, s.runPending)
	}
	s.mu.Unlock()
}

func (s *VerificationService) process(
	ctx context.Context,
	refs []dto.VerifiedFixtureRef,
	generations map[string]uint64,
) error {
	candidates, err := s.candidates.ListCurrentSurebets(ctx)
	if err != nil {
		return err
	}
	affected := affectedCandidates(candidates, refs)
	semaphore := make(chan struct{}, 2)
	var wait sync.WaitGroup
	for _, candidate := range affected {
		candidate := candidate
		wait.Add(1)
		go func() {
			defer wait.Done()
			select {
			case semaphore <- struct{}{}:
				defer func() { <-semaphore }()
			case <-ctx.Done():
				return
			}
			s.verifyCandidate(ctx, candidate, generations)
		}()
	}
	wait.Wait()
	return ctx.Err()
}

func (s *VerificationService) verifyCandidate(
	ctx context.Context,
	candidate dto.SurebetView,
	generations map[string]uint64,
) {
	startedAt := time.Now()
	item, confirmed, err := s.confirmer.ConfirmCurrentSurebet(ctx, candidate.ID)
	latency := time.Since(startedAt)
	isParserError := err != nil && strings.Contains(strings.ToLower(err.Error()), "odds format")
	_ = s.store.RecordVerification(ctx, confirmed, latency, err != nil, isParserError)
	s.logSummaryIfDue(ctx)
	if err != nil || !confirmed {
		reason := "collector confirmation rejected"
		if err != nil {
			reason = err.Error()
		}
		s.publish(dto.SurebetVerificationEvent{
			OpportunityID: candidate.ID,
			Status:        "rejected",
			Reason:        reason,
		})
		s.evaluateCircuitBreaker(ctx)
		return
	}
	s.invalidationMu.Lock()
	if s.candidateChangedSince(candidate, generations) && !s.confirmedStillCurrent(ctx, item) {
		_ = s.store.Delete(ctx, item.ID)
		s.publish(dto.SurebetVerificationEvent{
			OpportunityID: item.ID,
			Status:        "rejected",
			Reason:        "source quote changed during confirmation",
		})
		s.invalidationMu.Unlock()
		return
	}

	s.publish(dto.SurebetVerificationEvent{
		OpportunityID: item.ID,
		Status:        "confirmed",
		ConfirmedAt:   item.ConfirmedAt,
		ValidUntil:    item.ValidUntil,
		Opportunity:   &item,
	})
	s.scheduleExpiry(item)
	mode := s.effectiveMode(ctx)
	s.invalidationMu.Unlock()
	if mode == "strict" && s.notifier != nil {
		if err := s.notifier.NotifyConfirmed(ctx, item); err != nil && s.log != nil {
			s.log.Warn("confirmed surebet notification enqueue failed", "error", err.Error(), "opportunity_id", item.ID)
		}
	}
}

func (s *VerificationService) confirmedStillCurrent(ctx context.Context, confirmed dto.SurebetView) bool {
	items, err := s.candidates.ListCurrentSurebets(ctx)
	if err != nil {
		return false
	}
	for _, current := range items {
		if current.ID != confirmed.ID || current.MatchAmbiguous || len(current.Legs) != len(confirmed.Legs) {
			continue
		}
		legs := make(map[string]float64, len(current.Legs))
		for _, leg := range current.Legs {
			legs[confirmationLegIdentity(leg)] = leg.Odds
		}
		matches := true
		for _, leg := range confirmed.Legs {
			odds, found := legs[confirmationLegIdentity(leg)]
			if !found || math.Abs(odds-leg.Odds) > 0.001 {
				matches = false
				break
			}
		}
		if matches {
			return true
		}
	}
	return false
}

func (s *VerificationService) candidateChangedSince(
	item dto.SurebetView,
	expected map[string]uint64,
) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, leg := range item.Legs {
		key := fixtureRefKey(dto.VerifiedFixtureRef{
			BookmakerID: leg.BookmakerID,
			LobbyID:     leg.LobbyID,
			FixtureID:   leg.FixtureID,
		})
		if s.generations[key] != expected[key] {
			return true
		}
	}
	return false
}

func (s *VerificationService) logSummaryIfDue(ctx context.Context) {
	if s.log == nil {
		return
	}
	s.mu.Lock()
	if !s.lastSummaryAt.IsZero() && time.Since(s.lastSummaryAt) < 5*time.Minute {
		s.mu.Unlock()
		return
	}
	s.lastSummaryAt = time.Now()
	s.mu.Unlock()
	snapshot, err := s.store.RolloutSnapshot(ctx)
	if err != nil {
		return
	}
	rate := float64(0)
	if snapshot.CandidateTotal > 0 {
		rate = float64(snapshot.ConfirmedTotal) / float64(snapshot.CandidateTotal)
	}
	s.log.Info(
		"surebet verification summary",
		"mode", snapshot.Mode,
		"candidates", snapshot.CandidateTotal,
		"confirmed", snapshot.ConfirmedTotal,
		"success_rate", rate,
		"p95_ms", percentile95(snapshot.Latencies).Milliseconds(),
		"errors", snapshot.ErrorTotal,
		"parser_errors", snapshot.ParserErrorTotal,
	)
}

func (s *VerificationService) scheduleExpiry(item dto.SurebetView) {
	delay := time.Until(item.ValidUntil)
	if delay < 0 {
		delay = 0
	}
	time.AfterFunc(delay, func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		current, found, err := s.store.Get(ctx, item.ID)
		if err != nil {
			return
		}
		if found && current.ConfirmedAt.Equal(item.ConfirmedAt) {
			if current.ValidUntil.After(time.Now()) {
				s.scheduleExpiry(current)
				return
			}
			_ = s.store.Delete(ctx, item.ID)
			found = false
		}
		if found {
			return
		}
		s.publish(dto.SurebetVerificationEvent{
			OpportunityID: item.ID,
			Status:        "expired",
			Reason:        "verification ttl elapsed",
		})
	})
}

func (s *VerificationService) effectiveMode(ctx context.Context) string {
	configured := strings.ToLower(strings.TrimSpace(s.cfg.VerificationMode))
	if configured == "strict" || configured == "shadow" || configured == "suppressed" {
		return configured
	}
	snapshot, err := s.store.RolloutSnapshot(ctx)
	if err != nil {
		return "shadow"
	}
	if snapshot.Mode == "suppressed" {
		return snapshot.Mode
	}
	if snapshot.Mode == "strict" {
		if s.health == nil || s.health.RequiredSourcesConnected() {
			return "strict"
		}
		_ = s.store.SetRolloutMode(ctx, "suppressed")
		if s.log != nil {
			s.log.Warn("surebet verification suppressed because a collector is stale")
		}
		return "suppressed"
	}
	if snapshot.StartedAt.IsZero() || time.Since(snapshot.StartedAt) < s.cfg.ShadowDuration ||
		snapshot.CandidateTotal < int64(s.cfg.ShadowMinSamples) || snapshot.CandidateTotal == 0 {
		return "shadow"
	}
	rate := float64(snapshot.ConfirmedTotal) / float64(snapshot.CandidateTotal)
	if rate < s.cfg.ShadowMinSuccessRate || percentile95(snapshot.Latencies) > s.cfg.ShadowMaxP95Latency ||
		snapshot.ParserErrorTotal > 0 || (s.health != nil && !s.health.RequiredSourcesConnected()) {
		return "shadow"
	}
	if err := s.store.SetRolloutMode(ctx, "strict"); err != nil {
		return "shadow"
	}
	if s.log != nil {
		s.log.Info("surebet verification promoted to strict", "samples", snapshot.CandidateTotal, "success_rate", rate)
	}
	return "strict"
}

func (s *VerificationService) evaluateCircuitBreaker(ctx context.Context) {
	if strings.ToLower(strings.TrimSpace(s.cfg.VerificationMode)) != "auto" {
		return
	}
	snapshot, err := s.store.RolloutSnapshot(ctx)
	if err != nil || snapshot.Mode != "strict" {
		return
	}
	if snapshot.ConsecutiveErrors >= 5 || (s.health != nil && !s.health.RequiredSourcesConnected()) {
		_ = s.store.SetRolloutMode(ctx, "suppressed")
		if s.log != nil {
			s.log.Warn(
				"surebet verification suppressed",
				"errors", snapshot.ConsecutiveErrors,
				"sources_fresh", s.health == nil || s.health.RequiredSourcesConnected(),
			)
		}
	}
}

func (s *VerificationService) publish(event dto.SurebetVerificationEvent) {
	if s.broadcaster == nil {
		return
	}
	s.broadcaster.Broadcast(realtime.Event{
		Type:    "surebet_verification_updated",
		SentAt:  time.Now().UTC(),
		Payload: event,
	})
}

func affectedCandidates(items []dto.SurebetView, refs []dto.VerifiedFixtureRef) []dto.SurebetView {
	refSet := make(map[string]struct{}, len(refs))
	for _, ref := range refs {
		refSet[fixtureRefKey(ref)] = struct{}{}
	}
	result := make([]dto.SurebetView, 0)
	for _, item := range items {
		for _, leg := range item.Legs {
			if _, ok := refSet[fixtureRefKey(dto.VerifiedFixtureRef{
				BookmakerID: leg.BookmakerID, LobbyID: leg.LobbyID, FixtureID: leg.FixtureID,
			})]; ok {
				result = append(result, item)
				break
			}
		}
	}
	return result
}

func fixtureRefKey(ref dto.VerifiedFixtureRef) string {
	return strings.Join([]string{ref.BookmakerID, ref.LobbyID, ref.FixtureID}, "\x00")
}

func percentile95(values []time.Duration) time.Duration {
	if len(values) == 0 {
		return 0
	}
	items := append([]time.Duration(nil), values...)
	sort.Slice(items, func(i, j int) bool { return items[i] < items[j] })
	index := (len(items)*95 + 99) / 100
	if index <= 0 {
		index = 1
	}
	return items[index-1]
}
