package betaction

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/google/uuid"

	"surebet/backend/internal/dto"
	"surebet/backend/internal/models"
	"surebet/backend/internal/repository"
)

const (
	ManualResolutionReview         = "manual_review"
	ManualResolutionReopen         = "reopen"
	ManualResolutionUnhedgedClosed = "unhedged_closed"
	ManualResolutionTicketAccepted = "ticket_accepted"
)

// ReconcileAction runs one targeted reconciliation against the original
// collector idempotency key. It never creates or sends another commit command.
func (s *LiveExecutionService) ReconcileAction(
	ctx context.Context,
	actionID string,
	expectedVersion int64,
) (dto.BetActionView, error) {
	if s == nil || !s.cfg.Enabled || !s.cfg.CommitEnabled || s.actions == nil ||
		s.attempts == nil || s.events == nil || s.collector == nil {
		return dto.BetActionView{}, ErrLiveExecutionDisabled
	}
	actionID = strings.TrimSpace(actionID)
	if actionID == "" || expectedVersion <= 0 {
		return dto.BetActionView{}, fmt.Errorf("%w: action id and expected_version are required", ErrInvalidRequest)
	}
	action, err := s.actions.GetByID(ctx, actionID)
	if err != nil {
		return dto.BetActionView{}, err
	}
	if action.Version != expectedVersion {
		return dto.BetActionView{}, repository.ErrVersionConflict
	}
	if !oneOf(action.Status, StatusSubmissionUnknown, StatusPlacingJun88, StatusPlacingEightXBet) {
		return dto.BetActionView{}, fmt.Errorf("%w: action is not in a reconcilable submission state", ErrInvalidStateTransition)
	}
	attempts, err := s.attempts.ListByAction(ctx, action.ID, liveAttemptQueryLimit)
	if err != nil {
		return dto.BetActionView{}, err
	}
	if !hasPendingCommitAttempt(attempts, "") {
		return dto.BetActionView{}, fmt.Errorf("%w: action has no unresolved commit attempt", ErrInvalidRequest)
	}
	if err := s.appendOperationalActionEvent(
		context.WithoutCancel(ctx), action, "manual_reconciliation_requested",
		"operator requested collector ticket reconciliation",
	); err != nil {
		return dto.BetActionView{}, err
	}
	s.publishLiveAction(action)
	if err := s.reconcileAction(ctx, action); err != nil {
		return dto.BetActionView{}, err
	}
	updated, err := s.actions.GetByID(ctx, action.ID)
	if err != nil {
		return dto.BetActionView{}, err
	}
	if oneOf(updated.Status, StatusSubmissionUnknown, StatusPlacingJun88, StatusPlacingEightXBet) {
		if err := s.appendOperationalActionEvent(
			context.WithoutCancel(ctx), updated, "manual_reconciliation_pending",
			"collector reconciliation did not produce a definitive ticket result",
		); err != nil {
			return dto.BetActionView{}, err
		}
		s.publishLiveAction(updated)
	}
	return toView(updated)
}

// ResolveExposure applies a narrowly-scoped operator decision. A completed
// exposure can only be recorded from an existing 8xbet commit attempt plus
// concrete ticket evidence that still produces positive P&L on both outcomes.
func (s *LiveExecutionService) ResolveExposure(
	ctx context.Context,
	exposureID string,
	request dto.ManualExposureResolutionRequest,
) (dto.BetExposureView, error) {
	if s == nil || s.actions == nil || s.attempts == nil || s.exposures == nil || s.events == nil {
		return dto.BetExposureView{}, ErrLiveExecutionDisabled
	}
	exposureID = strings.TrimSpace(exposureID)
	request.Resolution = strings.TrimSpace(strings.ToLower(request.Resolution))
	request.Reason = strings.TrimSpace(request.Reason)
	if exposureID == "" || request.ExpectedVersion <= 0 || request.Reason == "" {
		return dto.BetExposureView{}, fmt.Errorf("%w: exposure id, expected_version and reason are required", ErrInvalidRequest)
	}
	exposure, err := s.exposures.GetByID(ctx, exposureID)
	if err != nil {
		return dto.BetExposureView{}, err
	}
	if exposure.Version != request.ExpectedVersion {
		return dto.BetExposureView{}, repository.ErrVersionConflict
	}
	if s.cfg.AccountID != "" && exposure.AccountID != s.cfg.AccountID {
		return dto.BetExposureView{}, fmt.Errorf("%w: exposure belongs to another account", ErrInvalidRequest)
	}
	action, err := s.actions.GetByID(ctx, exposure.ActionID)
	if err != nil {
		return dto.BetExposureView{}, err
	}
	if action.ExposureID != exposure.ID || !action.ExposureOpen {
		return dto.BetExposureView{}, fmt.Errorf("%w: action is not linked to an open exposure", ErrInvalidStateTransition)
	}
	attempts, err := s.attempts.ListByAction(ctx, action.ID, liveAttemptQueryLimit)
	if err != nil {
		return dto.BetExposureView{}, err
	}

	switch request.Resolution {
	case ManualResolutionReview:
		return s.markExposureForManualReview(ctx, action, exposure, request.Reason)
	case ManualResolutionReopen:
		return s.reopenManualExposure(ctx, action, exposure, attempts, request.Reason)
	case ManualResolutionUnhedgedClosed:
		return s.closeExposureUnhedged(ctx, action, exposure, attempts, request)
	case ManualResolutionTicketAccepted:
		return s.completeExposureFromManualTicket(ctx, action, exposure, attempts, request)
	default:
		return dto.BetExposureView{}, fmt.Errorf("%w: unsupported manual resolution %q", ErrInvalidRequest, request.Resolution)
	}
}

func (s *LiveExecutionService) markExposureForManualReview(
	ctx context.Context,
	action models.BetAction,
	exposure models.BetExposure,
	reason string,
) (dto.BetExposureView, error) {
	if exposure.Status != ExposureStatusOpen && exposure.Status != ExposureStatusSubmissionUnknown {
		return dto.BetExposureView{}, fmt.Errorf("%w: only open or unknown exposures can enter manual review", ErrInvalidStateTransition)
	}
	if err := TransitionBetExposure(&exposure, ExposureStatusManualReview, s.now().UTC()); err != nil {
		return dto.BetExposureView{}, err
	}
	exposure.LastFailureCode = "manual_review_requested"
	exposure.LastFailureMessage = reason
	updated, err := s.exposures.UpdateCAS(context.WithoutCancel(ctx), exposure, exposure.Version)
	if err != nil {
		return dto.BetExposureView{}, err
	}
	if err := s.appendExposureOperationalEvent(
		context.WithoutCancel(ctx), action, updated, "exposure_manual_review", reason,
	); err != nil {
		return dto.BetExposureView{}, err
	}
	s.publishExposure(updated)
	s.publishLiveAction(action)
	return ToBetExposureView(updated), nil
}

func (s *LiveExecutionService) reopenManualExposure(
	ctx context.Context,
	action models.BetAction,
	exposure models.BetExposure,
	attempts []models.BetAttempt,
	reason string,
) (dto.BetExposureView, error) {
	if exposure.Status != ExposureStatusManualReview || action.Status != StatusExposureOpen {
		return dto.BetExposureView{}, fmt.Errorf("%w: only a reviewed open action can be reopened", ErrInvalidStateTransition)
	}
	if hasPendingCommitAttempt(attempts, "8xbet") {
		return dto.BetExposureView{}, fmt.Errorf("%w: reconcile the unresolved 8xbet commit before reopening", ErrInvalidStateTransition)
	}
	if err := TransitionBetExposure(&exposure, ExposureStatusOpen, s.now().UTC()); err != nil {
		return dto.BetExposureView{}, err
	}
	next := s.now().UTC()
	exposure.NextEvaluationAt = &next
	exposure.LastFailureCode = "manual_reopened"
	exposure.LastFailureMessage = reason
	updated, err := s.exposures.UpdateCAS(context.WithoutCancel(ctx), exposure, exposure.Version)
	if err != nil {
		return dto.BetExposureView{}, err
	}
	if err := s.appendExposureOperationalEvent(
		context.WithoutCancel(ctx), action, updated, "exposure_manual_reopened", reason,
	); err != nil {
		return dto.BetExposureView{}, err
	}
	s.publishExposure(updated)
	s.publishLiveAction(action)
	return ToBetExposureView(updated), nil
}

func (s *LiveExecutionService) closeExposureUnhedged(
	ctx context.Context,
	action models.BetAction,
	exposure models.BetExposure,
	attempts []models.BetAttempt,
	request dto.ManualExposureResolutionRequest,
) (dto.BetExposureView, error) {
	if exposure.Status != ExposureStatusOpen && exposure.Status != ExposureStatusManualReview {
		return dto.BetExposureView{}, fmt.Errorf("%w: unknown or in-flight submissions must be reconciled before closure", ErrInvalidStateTransition)
	}
	if action.Status != StatusExposureOpen || hasPendingCommitAttempt(attempts, "8xbet") {
		return dto.BetExposureView{}, fmt.Errorf("%w: unresolved 8xbet commit prevents unhedged closure", ErrInvalidStateTransition)
	}
	if request.MarketClosedAt == nil || request.MarketClosedAt.IsZero() {
		return dto.BetExposureView{}, fmt.Errorf("%w: market_closed_at is required", ErrInvalidRequest)
	}
	view, err := toView(action)
	if err != nil {
		return dto.BetExposureView{}, err
	}
	closedAt := request.MarketClosedAt.UTC()
	now := s.now().UTC()
	if closedAt.After(now.Add(liveClockTolerance)) || closedAt.Before(exposure.OpenedAt.Add(-liveClockTolerance)) {
		return dto.BetExposureView{}, fmt.Errorf("%w: market_closed_at is outside the exposure lifetime", ErrInvalidRequest)
	}
	if err := TransitionBetExposure(&exposure, ExposureStatusUnhedgedClosed, now); err != nil {
		return dto.BetExposureView{}, err
	}
	exposure.MarketClosedAt = &closedAt
	exposure.LastFailureCode = "manual_unhedged_closed"
	exposure.LastFailureMessage = request.Reason
	updated, err := s.exposures.UpdateCAS(context.WithoutCancel(ctx), exposure, exposure.Version)
	if err != nil {
		return dto.BetExposureView{}, err
	}
	action.ErrorCode = exposure.LastFailureCode
	action.ErrorMessage = request.Reason
	if err := s.transitionAction(
		ctx, &action, view.Legs, StatusUnhedgedClosed,
		"exposure_manually_closed_unhedged", request.Reason,
	); err != nil {
		return dto.BetExposureView{}, err
	}
	s.publishExposure(updated)
	s.releaseActionReservation(ctx, &action)
	return ToBetExposureView(updated), nil
}

func (s *LiveExecutionService) completeExposureFromManualTicket(
	ctx context.Context,
	action models.BetAction,
	exposure models.BetExposure,
	attempts []models.BetAttempt,
	request dto.ManualExposureResolutionRequest,
) (dto.BetExposureView, error) {
	if !oneOf(exposure.Status, ExposureStatusOpen, ExposureStatusSubmissionUnknown, ExposureStatusManualReview) ||
		!oneOf(action.Status, StatusExposureOpen, StatusSubmissionUnknown, StatusPlacingEightXBet) {
		return dto.BetExposureView{}, fmt.Errorf("%w: exposure cannot accept manual ticket evidence in its current state", ErrInvalidStateTransition)
	}
	attempt, err := validateManualHedgeTicketEvidence(exposure, attempts, request, s.now().UTC())
	if err != nil {
		return dto.BetExposureView{}, err
	}
	actionView, err := toView(action)
	if err != nil {
		return dto.BetExposureView{}, err
	}
	foundLeg := false
	for index := range actionView.Legs {
		if actionView.Legs[index].BookmakerID != "8xbet" {
			continue
		}
		if actionView.Legs[index].ProviderReference != exposure.HedgeProviderReference {
			return dto.BetExposureView{}, fmt.Errorf("%w: action hedge leg does not match ticket evidence", ErrInvalidRequest)
		}
		foundLeg = true
	}
	if !foundLeg {
		return dto.BetExposureView{}, fmt.Errorf("%w: action has no 8xbet hedge leg", ErrInvalidRequest)
	}

	candidate := exposure
	candidate.HedgeAttemptID = attempt.ID
	candidate.HedgeTicketID = strings.TrimSpace(request.TicketID)
	candidate.HedgeAcceptedOdds = request.AcceptedOdds
	candidate.HedgeAcceptedStakeVND = request.AcceptedStakeVND
	acceptedAt := request.AcceptedAt.UTC()
	candidate.HedgeAcceptedAt = &acceptedAt
	if !acceptedTicketsProfitable(candidate) {
		return dto.BetExposureView{}, fmt.Errorf("%w: ticket evidence does not produce positive P&L on both outcomes", ErrNoProfitableHedge)
	}
	junDecimal, _ := malayDecimalOdds(candidate.Jun88AcceptedOdds)
	hedgeDecimal, _ := malayDecimalOdds(candidate.HedgeAcceptedOdds)
	totalStake := candidate.Jun88StakeVND + candidate.HedgeAcceptedStakeVND
	candidate.ProjectedJunProfitVND = int64(math.Round(float64(candidate.Jun88StakeVND)*junDecimal - float64(totalStake)))
	candidate.ProjectedHedgeProfitVND = int64(math.Round(float64(candidate.HedgeAcceptedStakeVND)*hedgeDecimal - float64(totalStake)))
	candidate.CurrentHedgeOdds = candidate.HedgeAcceptedOdds
	candidate.RequiredHedgeStakeVND = candidate.HedgeAcceptedStakeVND
	candidate.LastFailureCode = ""
	candidate.LastFailureMessage = ""
	if candidate.Status == ExposureStatusOpen {
		if err := TransitionBetExposure(&candidate, ExposureStatusHedging, s.now().UTC()); err != nil {
			return dto.BetExposureView{}, err
		}
	}
	if err := TransitionBetExposure(&candidate, ExposureStatusCompleted, s.now().UTC()); err != nil {
		return dto.BetExposureView{}, err
	}

	if attempt.Status != AttemptStatusResponseReceived {
		if err := TransitionBetAttempt(&attempt, AttemptStatusResponseReceived, s.now().UTC()); err != nil {
			return dto.BetExposureView{}, err
		}
		attempt.Result = "ticket_accepted"
		attempt.TicketID = candidate.HedgeTicketID
		attempt.AcceptedOdds = candidate.HedgeAcceptedOdds
		attempt.AcceptedStakeVND = candidate.HedgeAcceptedStakeVND
		attempt.ObservedAt = &acceptedAt
		reconciledAt := s.now().UTC()
		attempt.ReconciledAt = &reconciledAt
		attempt.ErrorCode = ""
		attempt.ErrorMessage = ""
		if _, err := s.attempts.UpdateCAS(context.WithoutCancel(ctx), attempt, attempt.Version); err != nil {
			return dto.BetExposureView{}, err
		}
	}
	updated, err := s.exposures.UpdateCAS(context.WithoutCancel(ctx), candidate, exposure.Version)
	if err != nil {
		return dto.BetExposureView{}, err
	}
	if err := s.appendExposureOperationalEvent(
		context.WithoutCancel(ctx), action, updated, "manual_8xbet_ticket_recorded", request.Reason,
	); err != nil {
		return dto.BetExposureView{}, err
	}
	for index := range actionView.Legs {
		if actionView.Legs[index].BookmakerID != "8xbet" {
			continue
		}
		actionView.Legs[index].Status = "ticket_received"
		actionView.Legs[index].TicketID = candidate.HedgeTicketID
		actionView.Legs[index].AcceptedOdds = candidate.HedgeAcceptedOdds
		actionView.Legs[index].StakeVND = candidate.HedgeAcceptedStakeVND
	}
	action.ErrorCode = ""
	action.ErrorMessage = ""
	if err := s.transitionAction(
		ctx, &action, actionView.Legs, StatusCompleted,
		"exposure_manually_completed", request.Reason,
	); err != nil {
		return dto.BetExposureView{}, err
	}
	s.publishExposure(updated)
	s.releaseActionReservation(ctx, &action)
	return ToBetExposureView(updated), nil
}

func validateManualHedgeTicketEvidence(
	exposure models.BetExposure,
	attempts []models.BetAttempt,
	request dto.ManualExposureResolutionRequest,
	now time.Time,
) (models.BetAttempt, error) {
	request.AttemptID = strings.TrimSpace(request.AttemptID)
	request.TicketID = strings.TrimSpace(request.TicketID)
	request.ProviderReference = strings.TrimSpace(request.ProviderReference)
	if request.AttemptID == "" || request.TicketID == "" || request.ProviderReference == "" ||
		request.AcceptedAt == nil || request.AcceptedAt.IsZero() || request.AcceptedStakeVND <= 0 ||
		!finiteMalayOdds(request.AcceptedOdds) {
		return models.BetAttempt{}, fmt.Errorf("%w: complete 8xbet ticket evidence is required", ErrInvalidRequest)
	}
	if request.ProviderReference != exposure.HedgeProviderReference {
		return models.BetAttempt{}, fmt.Errorf("%w: provider reference does not match the hedge selection", ErrInvalidRequest)
	}
	acceptedAt := request.AcceptedAt.UTC()
	if acceptedAt.After(now.UTC().Add(liveClockTolerance)) ||
		acceptedAt.Before(exposure.OpenedAt.Add(-liveClockTolerance)) {
		return models.BetAttempt{}, fmt.Errorf("%w: accepted_at is outside the exposure lifetime", ErrInvalidRequest)
	}
	var selected *models.BetAttempt
	for index := range attempts {
		if attempts[index].ID == request.AttemptID {
			selected = &attempts[index]
			break
		}
	}
	if selected == nil || selected.ActionID != exposure.ActionID || selected.ExposureID != exposure.ID ||
		selected.BookmakerID != "8xbet" || selected.Phase != AttemptPhaseCommit ||
		selected.ProviderReference != exposure.HedgeProviderReference ||
		selected.FixtureID != exposure.HedgeFixtureID || selected.MarketID != exposure.HedgeMarketID ||
		selected.OutcomeID != exposure.HedgeOutcomeID {
		return models.BetAttempt{}, fmt.Errorf("%w: attempt is not the exposure's 8xbet commit", ErrInvalidRequest)
	}
	if selected.Status == AttemptStatusResponseReceived {
		if selected.Result != "ticket_accepted" || selected.TicketID != request.TicketID ||
			selected.AcceptedStakeVND != request.AcceptedStakeVND ||
			math.Abs(selected.AcceptedOdds-request.AcceptedOdds) > liveOddsTolerance {
			return models.BetAttempt{}, fmt.Errorf("%w: stored ticket result conflicts with supplied evidence", ErrInvalidRequest)
		}
	} else if selected.Status != AttemptStatusAwaitingReconcile && selected.Status != AttemptStatusSubmitStarted {
		return models.BetAttempt{}, fmt.Errorf("%w: attempt was not submitted to 8xbet", ErrInvalidStateTransition)
	}
	if selected.SubmitStartedAt != nil && acceptedAt.Before(selected.SubmitStartedAt.Add(-liveClockTolerance)) {
		return models.BetAttempt{}, fmt.Errorf("%w: ticket predates the 8xbet submission", ErrInvalidRequest)
	}
	if selected.RequestedStakeVND != request.AcceptedStakeVND ||
		request.AcceptedStakeVND > exposure.MaximumTotalStakeVND-exposure.Jun88StakeVND ||
		(selected.MinimumStakeVND > 0 && request.AcceptedStakeVND < selected.MinimumStakeVND) ||
		(selected.MaximumStakeVND > 0 && request.AcceptedStakeVND > selected.MaximumStakeVND) ||
		selected.StakeIncrementVND <= 0 || request.AcceptedStakeVND%selected.StakeIncrementVND != 0 {
		return models.BetAttempt{}, fmt.Errorf("%w: accepted stake violates the committed hedge terms", ErrInvalidRequest)
	}
	return *selected, nil
}

func hasPendingCommitAttempt(attempts []models.BetAttempt, bookmakerID string) bool {
	for _, attempt := range attempts {
		if attempt.Phase != AttemptPhaseCommit ||
			(bookmakerID != "" && attempt.BookmakerID != bookmakerID) {
			continue
		}
		if attempt.Status == AttemptStatusSubmitStarted || attempt.Status == AttemptStatusAwaitingReconcile {
			return true
		}
	}
	return false
}

func (s *LiveExecutionService) appendOperationalActionEvent(
	ctx context.Context,
	action models.BetAction,
	eventType, message string,
) error {
	metadata, _ := json.Marshal(map[string]any{"action_version": action.Version})
	event := newJournalEvent(action, action.ExposureID, eventType, "", message, s.now().UTC())
	event.IdempotencyKey = fmt.Sprintf("%s:event:%s:action:%d", action.ID, eventType, action.Version)
	event.Metadata = metadata
	_, _, err := s.events.Append(ctx, event)
	return err
}

func (s *LiveExecutionService) appendExposureOperationalEvent(
	ctx context.Context,
	action models.BetAction,
	exposure models.BetExposure,
	eventType, message string,
) error {
	metadata, _ := json.Marshal(map[string]any{
		"exposure_id": exposure.ID, "exposure_version": exposure.Version,
		"exposure_status": exposure.Status,
	})
	at := s.now().UTC()
	event := models.BetActionEvent{
		BaseModel:      models.BaseModel{ID: uuid.NewString(), CreatedAt: at, UpdatedAt: at},
		IdempotencyKey: fmt.Sprintf("%s:event:%s:exposure:%d", action.ID, eventType, exposure.Version),
		ActionID:       action.ID, ExposureID: exposure.ID, Type: eventType, Status: action.Status,
		BookmakerID: "8xbet", Message: message, Metadata: metadata, OccurredAt: at,
	}
	_, _, err := s.events.Append(ctx, event)
	return err
}
