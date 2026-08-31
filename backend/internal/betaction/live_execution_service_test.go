package betaction

import (
	"context"
	"errors"
	"sort"
	"sync"
	"testing"
	"time"

	"surebet/backend/internal/config"
	"surebet/backend/internal/dto"
	"surebet/backend/internal/models"
	"surebet/backend/internal/repository"
)

func TestLiveExecutionDryRunPreparesAndCancelsWithoutCommit(t *testing.T) {
	store := newLiveStoreStub()
	collector := newLiveCollectorStub()
	service := newTestLiveExecutionService(store, collector, false)

	view, err := service.Execute(context.Background(), liveCandidate(-0.88))
	if err != nil {
		t.Fatalf("execute dry run: %v", err)
	}
	if view.Status != StatusDryRunCompleted || view.CompletedAt == nil || view.ExposureOpen {
		t.Fatalf("unexpected dry-run action: %+v", view)
	}
	if collector.countType("commit_bet") != 0 || collector.countType("prepare_bet") != 2 ||
		collector.countType("cancel_prepared_bet") != 2 {
		t.Fatalf("dry run command set is invalid: %+v", collector.commandsSnapshot())
	}
	stored, _ := store.action(view.ActionID)
	if stored.ReservedStakeVND != 0 {
		t.Fatalf("dry run did not release account reservation: %+v", stored)
	}
}

func TestLiveExecutionCommitsJun88BeforeEightXBet(t *testing.T) {
	store := newLiveStoreStub()
	collector := newLiveCollectorStub()
	service := newTestLiveExecutionService(store, collector, true)

	view, err := service.Execute(context.Background(), liveCandidate(-0.88))
	if err != nil {
		t.Fatalf("execute live: %v", err)
	}
	if view.Status != StatusCompleted || view.CompletedAt == nil || view.ExposureOpen {
		t.Fatalf("unexpected completed action: %+v", view)
	}
	commits := collector.commitBookmakers()
	if len(commits) != 2 || commits[0] != "jun88" || commits[1] != "8xbet" {
		t.Fatalf("commit order must be Jun88 then 8xbet: %+v", commits)
	}
	exposures := store.exposureList("")
	if len(exposures) != 1 || exposures[0].Status != ExposureStatusCompleted ||
		exposures[0].Jun88TicketID == "" || exposures[0].HedgeTicketID == "" {
		t.Fatalf("durable exposure did not complete: %+v", exposures)
	}
}

func TestLiveExecutionRetriesProfitableJun88Reprice(t *testing.T) {
	store := newLiveStoreStub()
	collector := newLiveCollectorStub()
	collector.results["jun88"] = []string{"odds_changed", "ticket_accepted"}
	collector.offered["jun88"] = -0.86
	service := newTestLiveExecutionService(store, collector, true)

	view, err := service.Execute(context.Background(), liveCandidate(-0.88))
	if err != nil {
		t.Fatalf("execute repriced live action: %v", err)
	}
	if view.Status != StatusCompleted || view.RepriceRevision != 1 {
		t.Fatalf("profitable Jun88 revision did not continue: %+v", view)
	}
	commits := collector.commitBookmakers()
	if len(commits) != 3 || commits[0] != "jun88" || commits[1] != "jun88" || commits[2] != "8xbet" {
		t.Fatalf("unexpected repriced commit order: %+v", commits)
	}
}

func TestLiveExecutionAbortsUnprofitableJun88RepriceWithoutEightXBet(t *testing.T) {
	store := newLiveStoreStub()
	collector := newLiveCollectorStub()
	collector.prepareOdds["8xbet"] = -1
	collector.results["jun88"] = []string{"odds_changed"}
	collector.offered["jun88"] = -1
	service := newTestLiveExecutionService(store, collector, true)

	view, err := service.Execute(context.Background(), liveCandidate(-1))
	if err != nil {
		t.Fatalf("execute unprofitable reprice: %v", err)
	}
	if view.Status != StatusAbortedNoExposure || view.ExposureOpen || view.CompletedAt == nil {
		t.Fatalf("unprofitable pre-ticket reprice must abort safely: %+v", view)
	}
	for _, bookmaker := range collector.commitBookmakers() {
		if bookmaker == "8xbet" {
			t.Fatal("8xbet was submitted after Jun88 reprice became unprofitable")
		}
	}
}

func TestLiveExecutionNeverRetriesUnknownJun88Submission(t *testing.T) {
	store := newLiveStoreStub()
	collector := newLiveCollectorStub()
	collector.results["jun88"] = []string{"lost_response"}
	service := newTestLiveExecutionService(store, collector, true)

	view, err := service.Execute(context.Background(), liveCandidate(-0.88))
	if err != nil {
		t.Fatalf("unknown submission should be persisted as state: %v", err)
	}
	if view.Status != StatusSubmissionUnknown || view.CompletedAt != nil {
		t.Fatalf("unknown Jun88 response must remain non-terminal: %+v", view)
	}
	commits := collector.commitBookmakers()
	if len(commits) != 1 || commits[0] != "jun88" {
		t.Fatalf("unknown Jun88 submit was retried or hedged blindly: %+v", commits)
	}
	attempts := store.attemptList(view.ActionID)
	foundUnknown := false
	for _, attempt := range attempts {
		if attempt.BookmakerID == "jun88" && attempt.Phase == AttemptPhaseCommit &&
			attempt.Status == AttemptStatusAwaitingReconcile {
			foundUnknown = true
		}
	}
	if !foundUnknown {
		t.Fatalf("unknown submission attempt was not retained: %+v", attempts)
	}
}

func TestReconciliationFindsJun88TicketWithoutRepeatingCommit(t *testing.T) {
	store := newLiveStoreStub()
	collector := newLiveCollectorStub()
	collector.results["jun88"] = []string{"lost_response"}
	collector.reconcileResults["jun88"] = "ticket_accepted"
	service := newTestLiveExecutionService(store, collector, true)
	view, err := service.Execute(context.Background(), liveCandidate(-0.88))
	if err != nil || view.Status != StatusSubmissionUnknown {
		t.Fatalf("unknown action setup failed: view=%+v err=%v", view, err)
	}
	beforeCommits := collector.countType("commit_bet")
	if err := service.ReconcilePending(context.Background()); err != nil {
		t.Fatalf("reconcile pending: %v", err)
	}
	if collector.countType("commit_bet") != beforeCommits || collector.countType("reconcile_bet") != 1 {
		t.Fatalf("reconciliation repeated a commit: %+v", collector.commandsSnapshot())
	}
	action, _ := store.action(view.ActionID)
	if action.Status != StatusExposureOpen || !action.ExposureOpen || action.CompletedAt != nil {
		t.Fatalf("reconciled Jun88 ticket did not open durable exposure: %+v", action)
	}
	exposure, _ := store.exposureForAction(view.ActionID)
	if exposure.Jun88TicketID == "" || exposure.Status != ExposureStatusOpen {
		t.Fatalf("reconciled ticket was not persisted: %+v", exposure)
	}
}

func TestReconciliationRecoversJun88SubmitStartedAfterRestart(t *testing.T) {
	store := newLiveStoreStub()
	collector := newLiveCollectorStub()
	collector.results["jun88"] = []string{"lost_response"}
	collector.reconcileResults["jun88"] = "ticket_accepted"
	service := newTestLiveExecutionService(store, collector, true)
	view, err := service.Execute(context.Background(), liveCandidate(-0.88))
	if err != nil || view.Status != StatusSubmissionUnknown {
		t.Fatalf("unknown Jun88 setup failed: view=%+v err=%v", view, err)
	}
	store.mu.Lock()
	action := store.actions[view.ActionID]
	action.Status = StatusPlacingJun88
	store.actions[action.ID] = action
	for id, attempt := range store.attempts {
		if attempt.ActionID == action.ID && attempt.BookmakerID == "jun88" &&
			attempt.Phase == AttemptPhaseCommit {
			attempt.Status = AttemptStatusSubmitStarted
			store.attempts[id] = attempt
		}
	}
	store.mu.Unlock()

	beforeCommits := collector.countType("commit_bet")
	if err := service.ReconcilePending(context.Background()); err != nil {
		t.Fatalf("reconcile Jun88 restart state: %v", err)
	}
	if collector.countType("commit_bet") != beforeCommits || collector.countType("reconcile_bet") != 1 {
		t.Fatalf("restart recovery repeated Jun88 commit: %+v", collector.commandsSnapshot())
	}
	recovered, _ := store.action(view.ActionID)
	if recovered.Status != StatusExposureOpen || !recovered.ExposureOpen || recovered.CompletedAt != nil {
		t.Fatalf("Jun88 restart recovery did not open exposure: %+v", recovered)
	}
}

func TestReconciliationReopensHedgingEightXBetAfterRestart(t *testing.T) {
	store := newLiveStoreStub()
	collector := newLiveCollectorStub()
	collector.results["8xbet"] = []string{"lost_response"}
	collector.reconcileResults["8xbet"] = "rejected"
	service := newTestLiveExecutionService(store, collector, true)
	view, err := service.Execute(context.Background(), liveCandidate(-0.88))
	if err != nil || view.Status != StatusSubmissionUnknown {
		t.Fatalf("unknown 8xbet setup failed: view=%+v err=%v", view, err)
	}
	store.mu.Lock()
	action := store.actions[view.ActionID]
	action.Status = StatusPlacingEightXBet
	store.actions[action.ID] = action
	for id, attempt := range store.attempts {
		if attempt.ActionID == action.ID && attempt.BookmakerID == "8xbet" &&
			attempt.Phase == AttemptPhaseCommit {
			attempt.Status = AttemptStatusSubmitStarted
			store.attempts[id] = attempt
		}
	}
	exposureID := store.exposureByAction[action.ID]
	exposure := store.exposures[exposureID]
	exposure.Status = ExposureStatusHedging
	store.exposures[exposureID] = exposure
	store.mu.Unlock()

	beforeCommits := collector.countType("commit_bet")
	if err := service.ReconcilePending(context.Background()); err != nil {
		t.Fatalf("reconcile 8xbet restart state: %v", err)
	}
	if collector.countType("commit_bet") != beforeCommits || collector.countType("reconcile_bet") != 1 {
		t.Fatalf("restart recovery repeated 8xbet commit: %+v", collector.commandsSnapshot())
	}
	recovered, _ := store.action(view.ActionID)
	if recovered.Status != StatusExposureOpen || recovered.CompletedAt != nil || !recovered.ExposureOpen {
		t.Fatalf("8xbet restart recovery did not reopen action: %+v", recovered)
	}
	recoveredExposure, _ := store.exposureForAction(view.ActionID)
	if recoveredExposure.Status != ExposureStatusOpen || recoveredExposure.CompletedAt != nil {
		t.Fatalf("8xbet restart recovery did not reopen hedging exposure: %+v", recoveredExposure)
	}
}

func TestOpenExposureIsHedgedByLaterProfitableQuote(t *testing.T) {
	store := newLiveStoreStub()
	collector := newLiveCollectorStub()
	collector.results["8xbet"] = []string{"odds_changed", "ticket_accepted"}
	collector.offered["8xbet"] = 0.80
	service := newTestLiveExecutionService(store, collector, true)

	view, err := service.Execute(context.Background(), liveCandidate(-0.88))
	if err != nil {
		t.Fatalf("execute exposure-opening action: %v", err)
	}
	if view.Status != StatusExposureOpen || !view.ExposureOpen || view.CompletedAt != nil {
		t.Fatalf("unprofitable 8xbet price must retain exposure: %+v", view)
	}
	exposures := store.exposureList(ExposureStatusOpen)
	if len(exposures) != 1 {
		t.Fatalf("expected one open exposure: %+v", exposures)
	}

	notifier := NewExposureHedgeNotifier(service)
	quote := liveEightXBetQuote(service.now(), exposures[0], -0.88, "inplay")
	if err := notifier.Notify(context.Background(), []models.OddsQuote{quote}); err != nil {
		t.Fatalf("notify profitable hedge: %v", err)
	}
	completed, err := store.action(view.ActionID)
	if err != nil || completed.Status != StatusCompleted || completed.CompletedAt == nil {
		t.Fatalf("later quote did not complete action: action=%+v err=%v", completed, err)
	}
	exposure, _ := store.exposureForAction(view.ActionID)
	if exposure.Status != ExposureStatusCompleted || exposure.HedgeTicketID == "" {
		t.Fatalf("later quote did not complete exposure: %+v", exposure)
	}
}

func TestExposureMarketCloseNeverForcesLossHedge(t *testing.T) {
	store := newLiveStoreStub()
	collector := newLiveCollectorStub()
	collector.results["8xbet"] = []string{"rejected"}
	service := newTestLiveExecutionService(store, collector, true)
	view, err := service.Execute(context.Background(), liveCandidate(-0.88))
	if err != nil || view.Status != StatusExposureOpen {
		t.Fatalf("open exposure setup failed: view=%+v err=%v", view, err)
	}
	exposure, _ := store.exposureForAction(view.ActionID)
	beforeCommits := collector.countType("commit_bet")
	notifier := NewExposureHedgeNotifier(service)
	quote := liveEightXBetQuote(service.now(), exposure, 0.80, "finished")
	if err := notifier.Notify(context.Background(), []models.OddsQuote{quote}); err != nil {
		t.Fatalf("close market: %v", err)
	}
	closed, _ := store.exposureForAction(view.ActionID)
	if closed.Status != ExposureStatusUnhedgedClosed || closed.CompletedAt != nil || closed.ClosedAt == nil {
		t.Fatalf("market close must record unhedged exposure: %+v", closed)
	}
	if collector.countType("commit_bet") != beforeCommits {
		t.Fatal("market close triggered an automatic loss hedge")
	}
}

func TestLiveExecutionIsIdempotentForStableConfirmationRevision(t *testing.T) {
	store := newLiveStoreStub()
	collector := newLiveCollectorStub()
	service := newTestLiveExecutionService(store, collector, true)
	candidate := liveCandidate(-0.88)
	first, err := service.Execute(context.Background(), candidate)
	if err != nil {
		t.Fatalf("first execution: %v", err)
	}
	commandCount := len(collector.commandsSnapshot())
	candidate.ConfirmedAt = candidate.ConfirmedAt.Add(time.Second)
	candidate.ValidUntil = candidate.ValidUntil.Add(time.Second)
	second, err := service.Execute(context.Background(), candidate)
	if err != nil {
		t.Fatalf("second execution: %v", err)
	}
	if first.ActionID != second.ActionID || len(collector.commandsSnapshot()) != commandCount {
		t.Fatalf("stable confirmation created duplicate action: first=%s second=%s", first.ActionID, second.ActionID)
	}
}

func TestOpenExposureKeepsAccountReservedAfterReservationTTL(t *testing.T) {
	store := newLiveStoreStub()
	collector := newLiveCollectorStub()
	collector.results["8xbet"] = []string{"rejected"}
	service := newTestLiveExecutionService(store, collector, true)
	first, err := service.Execute(context.Background(), liveCandidate(-0.88))
	if err != nil || first.Status != StatusExposureOpen {
		t.Fatalf("open exposure setup failed: view=%+v err=%v", first, err)
	}
	store.mu.Lock()
	open := store.actions[first.ActionID]
	expired := service.now().Add(-time.Minute)
	open.ReservationExpiresAt = &expired
	open.LeaseExpiresAt = &expired
	store.actions[open.ID] = open
	store.mu.Unlock()

	beforeCommands := len(collector.commandsSnapshot())
	nextCandidate := liveCandidate(-0.88)
	nextCandidate.Legs[0].ProviderRef += "|revision-2"
	nextCandidate.Legs[0].SourceEventID += "-revision-2"
	second, err := service.Execute(context.Background(), nextCandidate)
	if err != nil {
		t.Fatalf("reservation conflict should persist an aborted action: %v", err)
	}
	if second.Status != StatusAbortedNoExposure || second.CompletedAt == nil {
		t.Fatalf("expired TTL released irreversible account risk: %+v", second)
	}
	if len(collector.commandsSnapshot()) != beforeCommands {
		t.Fatal("second action reached collectors while an open exposure still reserved the account")
	}
}

func newTestLiveExecutionService(
	store *liveStoreStub,
	collector *liveCollectorStub,
	commitEnabled bool,
) *LiveExecutionService {
	service := NewLiveExecutionService(
		&liveActionRepoStub{store}, &liveAttemptRepoStub{store},
		&liveExposureRepoStub{store}, &liveEventRepoStub{store}, collector,
		config.AutoBetLiveConfig{
			Enabled: true, CommitEnabled: commitEnabled, AccountID: "account-1",
			TotalStakeVND: 100_000, CommandTimeout: time.Second,
			MaxJun88Reprices: 3, MaxOpenExposures: 2,
			MaxDailyTurnoverVND: 10_000_000, BalanceFloorVND: 10_000,
			LeaseDuration: time.Minute,
		},
		nil, nil,
	)
	service.now = func() time.Time {
		return time.Date(2026, time.August, 14, 10, 0, 0, 0, time.UTC)
	}
	collector.now = service.now
	return service
}

func liveCandidate(eightOdds float64) dto.SurebetView {
	now := time.Date(2026, time.August, 14, 10, 0, 0, 0, time.UTC)
	eightRaw := -1 / eightOdds
	return dto.SurebetView{
		ID: "live-opportunity-1", VerificationStatus: "confirmed", ConfirmedAt: now,
		ValidUntil: now.Add(30 * time.Second), ExpiresAt: now.Add(30 * time.Second),
		Legs: []dto.SurebetLegView{
			{
				BookmakerID: "8xbet", LobbyID: "default", FixtureID: "8-fixture",
				MarketID: "ou", OutcomeID: "under", OutcomeName: "Under 2.5",
				Odds: eightOdds, RawOdds: eightRaw, OddsFormat: "indonesian",
				SourceEventID: "8-event", ProviderRef: "1|8-fixture|ou|under|2.5", ObservedAt: now,
			},
			{
				BookmakerID: "jun88", LobbyID: "cmd", FixtureID: "jun-fixture",
				MarketID: "ou", OutcomeID: "over", OutcomeName: "Over 2.5",
				Odds: -0.92, RawOdds: -0.92, OddsFormat: "malay",
				SourceEventID: "jun-event", ProviderRef: "25212060_OU_Over", ObservedAt: now,
			},
		},
	}
}

func liveEightXBetQuote(
	now time.Time,
	exposure models.BetExposure,
	odds float64,
	matchState string,
) models.OddsQuote {
	return models.OddsQuote{
		ID: "quote-later", BookmakerID: "8xbet", LobbyID: "default",
		FixtureID: exposure.HedgeFixtureID, MarketID: exposure.HedgeMarketID,
		OutcomeID: exposure.HedgeOutcomeID, OutcomeName: "Under 2.5",
		ProviderReference: exposure.HedgeProviderReference,
		Odds:              odds, RawOdds: -1 / odds, OddsFormat: "indonesian",
		SourceEventID: "8-event", MatchState: matchState,
		AvailableStake: 1_000_000, CollectedAt: now, LastObservedAt: now,
	}
}

type liveStoreStub struct {
	mu               sync.Mutex
	actions          map[string]models.BetAction
	actionKey        map[string]string
	attempts         map[string]models.BetAttempt
	attemptKey       map[string]string
	exposures        map[string]models.BetExposure
	exposureByAction map[string]string
	events           []models.BetActionEvent
}

func newLiveStoreStub() *liveStoreStub {
	return &liveStoreStub{
		actions: make(map[string]models.BetAction), actionKey: make(map[string]string),
		attempts: make(map[string]models.BetAttempt), attemptKey: make(map[string]string),
		exposures: make(map[string]models.BetExposure), exposureByAction: make(map[string]string),
	}
}

func (s *liveStoreStub) createAction(action models.BetAction) (models.BetAction, bool, error) {
	if id := s.actionKey[action.IdempotencyKey]; id != "" {
		return s.actions[id], false, nil
	}
	if action.Version <= 0 {
		action.Version = 1
	}
	s.actions[action.ID] = action
	s.actionKey[action.IdempotencyKey] = action.ID
	return action, true, nil
}

func (s *liveStoreStub) action(id string) (models.BetAction, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	action, ok := s.actions[id]
	if !ok {
		return models.BetAction{}, repository.ErrNotFound
	}
	return action, nil
}

func (s *liveStoreStub) exposureForAction(actionID string) (models.BetExposure, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	id := s.exposureByAction[actionID]
	exposure, ok := s.exposures[id]
	if !ok {
		return models.BetExposure{}, repository.ErrNotFound
	}
	return exposure, nil
}

func (s *liveStoreStub) exposureList(status string) []models.BetExposure {
	s.mu.Lock()
	defer s.mu.Unlock()
	result := make([]models.BetExposure, 0, len(s.exposures))
	for _, exposure := range s.exposures {
		if status == "" || exposure.Status == status {
			result = append(result, exposure)
		}
	}
	return result
}

func (s *liveStoreStub) attemptList(actionID string) []models.BetAttempt {
	s.mu.Lock()
	defer s.mu.Unlock()
	result := make([]models.BetAttempt, 0)
	for _, attempt := range s.attempts {
		if attempt.ActionID == actionID {
			result = append(result, attempt)
		}
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].AttemptNumber == result[j].AttemptNumber {
			return result[i].CreatedAt.Before(result[j].CreatedAt)
		}
		return result[i].AttemptNumber < result[j].AttemptNumber
	})
	return result
}

type liveActionRepoStub struct{ store *liveStoreStub }

func (r *liveActionRepoStub) Create(
	_ context.Context,
	action models.BetAction,
) (models.BetAction, bool, error) {
	r.store.mu.Lock()
	defer r.store.mu.Unlock()
	return r.store.createAction(action)
}

func (r *liveActionRepoStub) UpdateCAS(
	_ context.Context,
	action models.BetAction,
	expectedVersion int64,
) (models.BetAction, error) {
	r.store.mu.Lock()
	defer r.store.mu.Unlock()
	current, ok := r.store.actions[action.ID]
	if !ok {
		return models.BetAction{}, repository.ErrNotFound
	}
	if current.Version != expectedVersion {
		return models.BetAction{}, repository.ErrVersionConflict
	}
	action.Version = expectedVersion + 1
	r.store.actions[action.ID] = action
	return action, nil
}

func (r *liveActionRepoStub) TryReserveAccountStake(
	_ context.Context,
	id, accountID, owner string,
	expectedVersion, stakeVND int64,
	now, expiresAt time.Time,
) (models.BetAction, bool, error) {
	r.store.mu.Lock()
	defer r.store.mu.Unlock()
	action, ok := r.store.actions[id]
	if !ok {
		return models.BetAction{}, false, repository.ErrNotFound
	}
	if action.Version != expectedVersion {
		return models.BetAction{}, false, repository.ErrVersionConflict
	}
	for _, other := range r.store.actions {
		if other.ID != id && other.AccountID == accountID && other.ReservedStakeVND > 0 &&
			((other.ReservationExpiresAt != nil && other.ReservationExpiresAt.After(now)) ||
				hasIrreversibleLiveRisk(other.Status)) &&
			other.CompletedAt == nil {
			return action, false, nil
		}
	}
	action.AccountID = accountID
	action.ReservedStakeVND = stakeVND
	action.ReservationExpiresAt = timePointer(expiresAt)
	action.LeaseOwner = owner
	action.LeaseExpiresAt = timePointer(expiresAt)
	action.Version++
	action.UpdatedAt = now
	r.store.actions[id] = action
	return action, true, nil
}

func hasIrreversibleLiveRisk(status string) bool {
	switch status {
	case StatusPlacingJun88, StatusJun88TicketReceived, StatusPlacingEightXBet,
		StatusExposureOpen, StatusSubmissionUnknown:
		return true
	default:
		return false
	}
}

func (r *liveActionRepoStub) ReleaseAccountStake(
	_ context.Context,
	id, accountID, owner string,
	expectedVersion int64,
	now time.Time,
) (models.BetAction, error) {
	r.store.mu.Lock()
	defer r.store.mu.Unlock()
	action, ok := r.store.actions[id]
	if !ok {
		return models.BetAction{}, repository.ErrNotFound
	}
	if action.Version != expectedVersion || action.AccountID != accountID || action.LeaseOwner != owner {
		return models.BetAction{}, repository.ErrVersionConflict
	}
	action.ReservedStakeVND = 0
	action.ReservationExpiresAt = nil
	action.LeaseOwner = ""
	action.LeaseExpiresAt = nil
	action.Version++
	action.UpdatedAt = now
	r.store.actions[id] = action
	return action, nil
}

func (r *liveActionRepoStub) GetByID(_ context.Context, id string) (models.BetAction, error) {
	return r.store.action(id)
}

func (r *liveActionRepoStub) List(
	_ context.Context,
	status string,
	limit int,
) ([]models.BetAction, error) {
	r.store.mu.Lock()
	defer r.store.mu.Unlock()
	result := make([]models.BetAction, 0, len(r.store.actions))
	for _, action := range r.store.actions {
		if status == "" || action.Status == status {
			result = append(result, action)
		}
	}
	sort.Slice(result, func(i, j int) bool { return result[i].CreatedAt.After(result[j].CreatedAt) })
	if limit > 0 && len(result) > limit {
		result = result[:limit]
	}
	return result, nil
}

type liveAttemptRepoStub struct{ store *liveStoreStub }

func (r *liveAttemptRepoStub) Create(
	_ context.Context,
	attempt models.BetAttempt,
) (models.BetAttempt, bool, error) {
	r.store.mu.Lock()
	defer r.store.mu.Unlock()
	if id := r.store.attemptKey[attempt.IdempotencyKey]; id != "" {
		return r.store.attempts[id], false, nil
	}
	if attempt.Version <= 0 {
		attempt.Version = 1
	}
	r.store.attempts[attempt.ID] = attempt
	r.store.attemptKey[attempt.IdempotencyKey] = attempt.ID
	return attempt, true, nil
}

func (r *liveAttemptRepoStub) UpdateCAS(
	_ context.Context,
	attempt models.BetAttempt,
	expectedVersion int64,
) (models.BetAttempt, error) {
	r.store.mu.Lock()
	defer r.store.mu.Unlock()
	current, ok := r.store.attempts[attempt.ID]
	if !ok {
		return models.BetAttempt{}, repository.ErrNotFound
	}
	if current.Version != expectedVersion {
		return models.BetAttempt{}, repository.ErrVersionConflict
	}
	attempt.Version = expectedVersion + 1
	r.store.attempts[attempt.ID] = attempt
	return attempt, nil
}

func (r *liveAttemptRepoStub) ListByAction(
	_ context.Context,
	actionID string,
	limit int,
) ([]models.BetAttempt, error) {
	result := r.store.attemptList(actionID)
	if limit > 0 && len(result) > limit {
		result = result[:limit]
	}
	return result, nil
}

type liveExposureRepoStub struct{ store *liveStoreStub }

func (r *liveExposureRepoStub) UpdateCAS(
	_ context.Context,
	exposure models.BetExposure,
	expectedVersion int64,
) (models.BetExposure, error) {
	r.store.mu.Lock()
	defer r.store.mu.Unlock()
	current, ok := r.store.exposures[exposure.ID]
	if !ok {
		return models.BetExposure{}, repository.ErrNotFound
	}
	if current.Version != expectedVersion {
		return models.BetExposure{}, repository.ErrVersionConflict
	}
	exposure.Version = expectedVersion + 1
	r.store.exposures[exposure.ID] = exposure
	return exposure, nil
}

func (r *liveExposureRepoStub) TryAcquireLease(
	_ context.Context,
	id, owner string,
	expectedVersion int64,
	now, expiresAt time.Time,
) (models.BetExposure, bool, error) {
	r.store.mu.Lock()
	defer r.store.mu.Unlock()
	exposure, ok := r.store.exposures[id]
	if !ok {
		return models.BetExposure{}, false, repository.ErrNotFound
	}
	if exposure.Version != expectedVersion {
		return models.BetExposure{}, false, repository.ErrVersionConflict
	}
	if exposure.LeaseExpiresAt != nil && exposure.LeaseExpiresAt.After(now) && exposure.LeaseOwner != owner {
		return exposure, false, nil
	}
	exposure.LeaseOwner = owner
	exposure.LeaseExpiresAt = timePointer(expiresAt)
	exposure.Version++
	exposure.UpdatedAt = now
	r.store.exposures[id] = exposure
	return exposure, true, nil
}

func (r *liveExposureRepoStub) ReleaseLease(
	_ context.Context,
	id, owner string,
	expectedVersion int64,
	now time.Time,
) (models.BetExposure, error) {
	r.store.mu.Lock()
	defer r.store.mu.Unlock()
	exposure, ok := r.store.exposures[id]
	if !ok {
		return models.BetExposure{}, repository.ErrNotFound
	}
	if exposure.Version != expectedVersion || exposure.LeaseOwner != owner {
		return models.BetExposure{}, repository.ErrVersionConflict
	}
	exposure.LeaseOwner = ""
	exposure.LeaseExpiresAt = nil
	exposure.Version++
	exposure.UpdatedAt = now
	r.store.exposures[id] = exposure
	return exposure, nil
}

func (r *liveExposureRepoStub) GetByID(
	_ context.Context,
	id string,
) (models.BetExposure, error) {
	r.store.mu.Lock()
	defer r.store.mu.Unlock()
	exposure, ok := r.store.exposures[id]
	if !ok {
		return models.BetExposure{}, repository.ErrNotFound
	}
	return exposure, nil
}

func (r *liveExposureRepoStub) List(
	_ context.Context,
	status string,
	limit int,
) ([]models.BetExposure, error) {
	result := r.store.exposureList(status)
	if limit > 0 && len(result) > limit {
		result = result[:limit]
	}
	return result, nil
}

func (r *liveExposureRepoStub) ListDue(
	_ context.Context,
	now time.Time,
	limit int,
) ([]models.BetExposure, error) {
	all := r.store.exposureList(ExposureStatusOpen)
	result := make([]models.BetExposure, 0, len(all))
	for _, exposure := range all {
		if (exposure.NextEvaluationAt == nil || !exposure.NextEvaluationAt.After(now)) &&
			(exposure.LeaseExpiresAt == nil || !exposure.LeaseExpiresAt.After(now)) {
			result = append(result, exposure)
		}
	}
	if limit > 0 && len(result) > limit {
		result = result[:limit]
	}
	return result, nil
}

func (r *liveExposureRepoStub) CommitJun88Ticket(
	_ context.Context,
	action models.BetAction,
	expectedActionVersion int64,
	attempt models.BetAttempt,
	expectedAttemptVersion int64,
	exposure models.BetExposure,
	event models.BetActionEvent,
) (models.BetExposure, bool, error) {
	r.store.mu.Lock()
	defer r.store.mu.Unlock()
	if id := r.store.exposureByAction[action.ID]; id != "" {
		return r.store.exposures[id], false, nil
	}
	currentAction, actionOK := r.store.actions[action.ID]
	currentAttempt, attemptOK := r.store.attempts[attempt.ID]
	if !actionOK || !attemptOK || currentAction.Version != expectedActionVersion ||
		currentAttempt.Version != expectedAttemptVersion {
		return models.BetExposure{}, false, repository.ErrVersionConflict
	}
	action.Version++
	attempt.Version++
	if exposure.Version <= 0 {
		exposure.Version = 1
	}
	r.store.actions[action.ID] = action
	r.store.attempts[attempt.ID] = attempt
	r.store.exposures[exposure.ID] = exposure
	r.store.exposureByAction[action.ID] = exposure.ID
	event.Sequence = int64(len(r.store.events) + 1)
	r.store.events = append(r.store.events, event)
	return exposure, true, nil
}

func (r *liveExposureRepoStub) GetByActionID(
	_ context.Context,
	actionID string,
) (models.BetExposure, error) {
	return r.store.exposureForAction(actionID)
}

type liveEventRepoStub struct{ store *liveStoreStub }

func (r *liveEventRepoStub) Append(
	_ context.Context,
	event models.BetActionEvent,
) (models.BetActionEvent, bool, error) {
	r.store.mu.Lock()
	defer r.store.mu.Unlock()
	for _, existing := range r.store.events {
		if existing.IdempotencyKey == event.IdempotencyKey {
			return existing, false, nil
		}
	}
	event.Sequence = int64(len(r.store.events) + 1)
	r.store.events = append(r.store.events, event)
	return event, true, nil
}

func timePointer(value time.Time) *time.Time {
	value = value.UTC()
	return &value
}

type recordedLiveCommand struct {
	source  dto.CollectorSource
	command dto.CollectorLiveBetRequest
}

type liveCollectorStub struct {
	mu               sync.Mutex
	commands         []recordedLiveCommand
	results          map[string][]string
	offered          map[string]float64
	prepareOdds      map[string]float64
	commitIndex      map[string]int
	prepareIndex     map[string]int
	reconcileResults map[string]string
	now              func() time.Time
}

func newLiveCollectorStub() *liveCollectorStub {
	return &liveCollectorStub{
		results: make(map[string][]string), offered: make(map[string]float64),
		prepareOdds: map[string]float64{"jun88": -0.92, "8xbet": -0.88},
		commitIndex: make(map[string]int), prepareIndex: make(map[string]int),
		reconcileResults: make(map[string]string),
		now:              func() time.Time { return time.Now().UTC() },
	}
}

func (s *liveCollectorStub) ExecuteLiveBet(
	_ context.Context,
	source dto.CollectorSource,
	command dto.CollectorLiveBetRequest,
) (dto.CollectorLiveBetResponse, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.commands = append(s.commands, recordedLiveCommand{source: source, command: command})
	response := dto.CollectorLiveBetResponse{
		ProtocolVersion: 4, SessionID: "session-" + source.BookmakerID,
		RequestID: "request-" + command.AttemptID, ActionID: command.ActionID,
		AttemptID: command.AttemptID, OpportunityID: command.OpportunityID,
		LegID: command.LegID, AccountID: command.AccountID, Source: source,
		ObservedAt: s.now().UTC(), SessionGeneration: "generation-1",
	}
	switch command.Type {
	case "prepare_bet":
		s.prepareIndex[source.BookmakerID]++
		odds := s.prepareOdds[source.BookmakerID]
		rawOdds := odds
		oddsFormat := "malay"
		if source.BookmakerID == "8xbet" {
			rawOdds = -1 / odds
			oddsFormat = "indonesian"
		}
		response.Type = "bet_prepared"
		response.Result = "prepared"
		response.PrepareID = "prepare-" + source.BookmakerID + "-" + string(rune('0'+s.prepareIndex[source.BookmakerID]))
		response.SlipFingerprint = "fingerprint-" + response.PrepareID
		response.DisplayedOdds = odds
		response.RawOdds = rawOdds
		response.OddsFormat = oddsFormat
		response.MinimumStakeVND = 1_000
		response.MaximumStakeVND = 1_000_000
		response.StakeIncrementVND = 1_000
		response.BalanceVND = 1_000_000
		return response, true, nil
	case "cancel_prepared_bet":
		response.Type = "bet_cancelled"
		response.Result = "cancelled"
		return response, true, nil
	case "reconcile_bet":
		response.Type = "bet_reconciled"
		response.Result = s.reconcileResults[source.BookmakerID]
		if response.Result == "" {
			response.Result = "rejected"
		}
		response.IdempotencyKey = command.IdempotencyKey
		if response.Result == "ticket_accepted" {
			response.TicketID = "RECONCILED-" + source.BookmakerID
			response.AcceptedOdds = commandExpectedOddsForReconcile(s.commands, source.BookmakerID)
			response.StakeVND = commandStakeForReconcile(s.commands, source.BookmakerID)
		}
		return response, true, nil
	case "commit_bet":
		response.Type = "bet_result"
		index := s.commitIndex[source.BookmakerID]
		s.commitIndex[source.BookmakerID] = index + 1
		result := "ticket_accepted"
		if configured := s.results[source.BookmakerID]; index < len(configured) {
			result = configured[index]
		}
		if result == "lost_response" {
			return dto.CollectorLiveBetResponse{}, true, errors.New("collector response lost")
		}
		response.Result = result
		response.IdempotencyKey = command.IdempotencyKey
		switch result {
		case "ticket_accepted":
			response.TicketID = "TICKET-" + source.BookmakerID + "-" + string(rune('0'+index+1))
			response.AcceptedOdds = command.ExpectedOdds
			response.StakeVND = command.StakeVND
		case "odds_changed":
			response.SubmittedOdds = command.ExpectedOdds
			response.OfferedOdds = s.offered[source.BookmakerID]
			response.ConfirmationRequired = true
		case "rejected":
			response.Error = source.BookmakerID + " rejected commit"
		case "submission_unknown":
			response.Error = source.BookmakerID + " could not determine submission result"
		}
		return response, true, nil
	default:
		return dto.CollectorLiveBetResponse{}, false, errors.New("unsupported fake command")
	}
}

func commandExpectedOddsForReconcile(commands []recordedLiveCommand, bookmaker string) float64 {
	for index := len(commands) - 1; index >= 0; index-- {
		if commands[index].source.BookmakerID == bookmaker && commands[index].command.Type == "commit_bet" {
			return commands[index].command.ExpectedOdds
		}
	}
	return 0
}

func commandStakeForReconcile(commands []recordedLiveCommand, bookmaker string) int64 {
	for index := len(commands) - 1; index >= 0; index-- {
		if commands[index].source.BookmakerID == bookmaker && commands[index].command.Type == "commit_bet" {
			return commands[index].command.StakeVND
		}
	}
	return 0
}

func (s *liveCollectorStub) commandsSnapshot() []recordedLiveCommand {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]recordedLiveCommand(nil), s.commands...)
}

func (s *liveCollectorStub) countType(commandType string) int {
	count := 0
	for _, item := range s.commandsSnapshot() {
		if item.command.Type == commandType {
			count++
		}
	}
	return count
}

func (s *liveCollectorStub) commitBookmakers() []string {
	result := make([]string, 0)
	for _, item := range s.commandsSnapshot() {
		if item.command.Type == "commit_bet" {
			result = append(result, item.source.BookmakerID)
		}
	}
	return result
}
