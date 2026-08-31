package betaction

import (
	"context"
	"errors"
	"testing"

	"surebet/backend/internal/dto"
	"surebet/backend/internal/models"
)

func TestTargetedReconciliationNeverRepeatsCommit(t *testing.T) {
	store := newLiveStoreStub()
	collector := newLiveCollectorStub()
	collector.results["jun88"] = []string{"lost_response"}
	collector.reconcileResults["jun88"] = "ticket_accepted"
	service := newTestLiveExecutionService(store, collector, true)

	view, err := service.Execute(context.Background(), liveCandidate(-0.88))
	if err != nil || view.Status != StatusSubmissionUnknown {
		t.Fatalf("unknown Jun88 setup failed: view=%+v err=%v", view, err)
	}
	commitCount := collector.countType("commit_bet")
	resolved, err := service.ReconcileAction(context.Background(), view.ActionID, view.Version)
	if err != nil {
		t.Fatalf("targeted reconcile: %v", err)
	}
	if resolved.Status != StatusExposureOpen || !resolved.ExposureOpen {
		t.Fatalf("reconciled Jun88 ticket did not open exposure: %+v", resolved)
	}
	if collector.countType("commit_bet") != commitCount || collector.countType("reconcile_bet") != 1 {
		t.Fatalf("targeted reconciliation repeated a commit: %+v", collector.commandsSnapshot())
	}
	if !liveStoreHasEvent(store, view.ActionID, "manual_reconciliation_requested") {
		t.Fatal("operator reconciliation was not journaled")
	}
}

func TestTargetedReconciliationRecoversSubmitStartedRestartState(t *testing.T) {
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
	store.actions[view.ActionID] = action
	for id, attempt := range store.attempts {
		if attempt.ActionID == view.ActionID && attempt.BookmakerID == "jun88" &&
			attempt.Phase == AttemptPhaseCommit && attempt.Status == AttemptStatusAwaitingReconcile {
			attempt.Status = AttemptStatusSubmitStarted
			attempt.Result = ""
			store.attempts[id] = attempt
		}
	}
	store.mu.Unlock()

	resolved, err := service.ReconcileAction(context.Background(), view.ActionID, view.Version)
	if err != nil {
		t.Fatalf("reconcile restart state: %v", err)
	}
	if resolved.Status != StatusExposureOpen || collector.countType("reconcile_bet") != 1 {
		t.Fatalf("submit_started state was not recovered safely: action=%+v commands=%+v", resolved, collector.commandsSnapshot())
	}
}

func TestManualReviewCanReopenOnlySettledOpenExposure(t *testing.T) {
	store := newLiveStoreStub()
	collector := newLiveCollectorStub()
	collector.results["8xbet"] = []string{"rejected"}
	service := newTestLiveExecutionService(store, collector, true)

	action, err := service.Execute(context.Background(), liveCandidate(-0.88))
	if err != nil || action.Status != StatusExposureOpen {
		t.Fatalf("open exposure setup failed: action=%+v err=%v", action, err)
	}
	exposure, _ := store.exposureForAction(action.ActionID)
	reviewed, err := service.ResolveExposure(context.Background(), exposure.ID, dto.ManualExposureResolutionRequest{
		Resolution: ManualResolutionReview, ExpectedVersion: exposure.Version,
		Reason: "operator is checking market availability",
	})
	if err != nil || reviewed.Status != ExposureStatusManualReview {
		t.Fatalf("manual review failed: exposure=%+v err=%v", reviewed, err)
	}
	reopened, err := service.ResolveExposure(context.Background(), exposure.ID, dto.ManualExposureResolutionRequest{
		Resolution: ManualResolutionReopen, ExpectedVersion: reviewed.Version,
		Reason: "market is available and no commit is pending",
	})
	if err != nil || reopened.Status != ExposureStatusOpen || reopened.NextEvaluationAt == nil {
		t.Fatalf("reopen failed: exposure=%+v err=%v", reopened, err)
	}
	if !liveStoreHasEvent(store, action.ActionID, "exposure_manual_review") ||
		!liveStoreHasEvent(store, action.ActionID, "exposure_manual_reopened") {
		t.Fatal("manual review lifecycle was not journaled")
	}
}

func TestManualUnhedgedClosureRejectsUnknownSubmission(t *testing.T) {
	store := newLiveStoreStub()
	collector := newLiveCollectorStub()
	collector.results["8xbet"] = []string{"lost_response"}
	service := newTestLiveExecutionService(store, collector, true)

	action, err := service.Execute(context.Background(), liveCandidate(-0.88))
	if err != nil || action.Status != StatusSubmissionUnknown {
		t.Fatalf("unknown hedge setup failed: action=%+v err=%v", action, err)
	}
	exposure, _ := store.exposureForAction(action.ActionID)
	closedAt := service.now()
	_, err = service.ResolveExposure(context.Background(), exposure.ID, dto.ManualExposureResolutionRequest{
		Resolution: ManualResolutionUnhedgedClosed, ExpectedVersion: exposure.Version,
		Reason: "operator believes the market closed", MarketClosedAt: &closedAt,
	})
	if !errors.Is(err, ErrInvalidStateTransition) {
		t.Fatalf("unknown submit must require reconciliation, got %v", err)
	}
	stored, _ := store.exposureForAction(action.ActionID)
	if stored.Status != ExposureStatusSubmissionUnknown || stored.ClosedAt != nil {
		t.Fatalf("unknown exposure was incorrectly closed: %+v", stored)
	}
}

func TestManualUnhedgedClosureRecordsTerminalMarketWithoutCompletingExposure(t *testing.T) {
	store := newLiveStoreStub()
	collector := newLiveCollectorStub()
	collector.results["8xbet"] = []string{"rejected"}
	service := newTestLiveExecutionService(store, collector, true)

	action, err := service.Execute(context.Background(), liveCandidate(-0.88))
	if err != nil || action.Status != StatusExposureOpen {
		t.Fatalf("open exposure setup failed: action=%+v err=%v", action, err)
	}
	exposure, _ := store.exposureForAction(action.ActionID)
	closedAt := service.now()
	closed, err := service.ResolveExposure(context.Background(), exposure.ID, dto.ManualExposureResolutionRequest{
		Resolution: ManualResolutionUnhedgedClosed, ExpectedVersion: exposure.Version,
		Reason: "fixture was permanently settled by the provider", MarketClosedAt: &closedAt,
	})
	if err != nil {
		t.Fatalf("close exposure unhedged: %v", err)
	}
	if closed.Status != ExposureStatusUnhedgedClosed || closed.CompletedAt != nil ||
		closed.ClosedAt == nil || closed.MarketClosedAt == nil {
		t.Fatalf("unhedged closure incorrectly recorded: %+v", closed)
	}
	storedAction, _ := store.action(action.ActionID)
	if storedAction.Status != StatusUnhedgedClosed || storedAction.CompletedAt == nil || storedAction.ExposureOpen {
		t.Fatalf("action did not enter unhedged terminal state: %+v", storedAction)
	}
}

func TestManualTicketEvidenceRequiresProfitableConcreteEightXBetAttempt(t *testing.T) {
	store := newLiveStoreStub()
	collector := newLiveCollectorStub()
	collector.results["8xbet"] = []string{"lost_response"}
	service := newTestLiveExecutionService(store, collector, true)

	action, err := service.Execute(context.Background(), liveCandidate(-0.88))
	if err != nil || action.Status != StatusSubmissionUnknown {
		t.Fatalf("unknown hedge setup failed: action=%+v err=%v", action, err)
	}
	exposure, _ := store.exposureForAction(action.ActionID)
	attempt := unresolvedEightXBetAttempt(t, store, action.ActionID)
	acceptedAt := service.now()
	request := dto.ManualExposureResolutionRequest{
		Resolution: ManualResolutionTicketAccepted, ExpectedVersion: exposure.Version,
		Reason: "ticket confirmed in 8xbet history", AttemptID: attempt.ID,
		TicketID: "8X-HISTORY-1", ProviderReference: exposure.HedgeProviderReference,
		AcceptedOdds: 0.80, AcceptedStakeVND: attempt.RequestedStakeVND, AcceptedAt: &acceptedAt,
	}
	if _, err := service.ResolveExposure(context.Background(), exposure.ID, request); !errors.Is(err, ErrNoProfitableHedge) {
		t.Fatalf("unprofitable ticket evidence must not complete exposure, got %v", err)
	}
	stored, _ := store.exposureForAction(action.ActionID)
	if stored.Status != ExposureStatusSubmissionUnknown || stored.HedgeTicketID != "" {
		t.Fatalf("unprofitable evidence changed durable exposure: %+v", stored)
	}

	request.AcceptedOdds = -0.88
	completed, err := service.ResolveExposure(context.Background(), exposure.ID, request)
	if err != nil {
		t.Fatalf("valid ticket evidence: %v", err)
	}
	if completed.Status != ExposureStatusCompleted || completed.HedgeTicketID != request.TicketID ||
		completed.ProjectedJunProfitVND <= 0 || completed.ProjectedHedgeProfitVND <= 0 {
		t.Fatalf("valid ticket evidence did not complete profitably: %+v", completed)
	}
	storedAction, _ := store.action(action.ActionID)
	if storedAction.Status != StatusCompleted || storedAction.CompletedAt == nil {
		t.Fatalf("manual ticket did not complete action: %+v", storedAction)
	}
}

func unresolvedEightXBetAttempt(t *testing.T, store *liveStoreStub, actionID string) models.BetAttempt {
	t.Helper()
	for _, attempt := range store.attemptList(actionID) {
		if attempt.BookmakerID == "8xbet" && attempt.Phase == AttemptPhaseCommit &&
			attempt.Status == AttemptStatusAwaitingReconcile {
			return attempt
		}
	}
	t.Fatal("missing unresolved 8xbet commit attempt")
	return models.BetAttempt{}
}

func liveStoreHasEvent(store *liveStoreStub, actionID, eventType string) bool {
	store.mu.Lock()
	defer store.mu.Unlock()
	for _, event := range store.events {
		if event.ActionID == actionID && event.Type == eventType {
			return true
		}
	}
	return false
}
