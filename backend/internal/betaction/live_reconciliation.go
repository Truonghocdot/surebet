package betaction

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"

	"surebet/backend/internal/dto"
	"surebet/backend/internal/models"
)

// ReconcilePending only sends reconcile_bet commands. It never repeats the
// original commit idempotency key as another commit, even when reconciliation
// itself times out.
func (s *LiveExecutionService) ReconcilePending(ctx context.Context) error {
	if s == nil || !s.cfg.Enabled || !s.cfg.CommitEnabled {
		return ErrLiveExecutionDisabled
	}
	actions := make([]models.BetAction, 0)
	seen := make(map[string]struct{})
	for _, status := range []string{
		StatusSubmissionUnknown,
		StatusPlacingJun88,
		StatusPlacingEightXBet,
	} {
		items, err := s.actions.List(ctx, status, 100)
		if err != nil {
			return err
		}
		for _, action := range items {
			if _, ok := seen[action.ID]; ok {
				continue
			}
			seen[action.ID] = struct{}{}
			actions = append(actions, action)
		}
	}
	var firstErr error
	for _, action := range actions {
		if err := s.reconcileAction(ctx, action); firstErr == nil && err != nil {
			firstErr = err
		}
	}
	return firstErr
}

func (s *LiveExecutionService) reconcileAction(ctx context.Context, action models.BetAction) error {
	attempts, err := s.attempts.ListByAction(ctx, action.ID, liveAttemptQueryLimit)
	if err != nil {
		return err
	}
	var original *models.BetAttempt
	reconcileNumber := 1
	for index := range attempts {
		attempt := &attempts[index]
		if attempt.Phase == AttemptPhaseReconcile && attempt.AttemptNumber >= reconcileNumber {
			reconcileNumber = attempt.AttemptNumber + 1
		}
		if attempt.Phase == AttemptPhaseCommit &&
			oneOf(attempt.Status, AttemptStatusSubmitStarted, AttemptStatusAwaitingReconcile) {
			if original == nil || attempt.CreatedAt.After(original.CreatedAt) {
				original = attempt
			}
		}
	}
	if original == nil {
		return nil
	}
	now := s.now().UTC()
	reconcile := models.BetAttempt{
		BaseModel:      models.BaseModel{ID: uuid.NewString(), CreatedAt: now, UpdatedAt: now},
		IdempotencyKey: fmt.Sprintf("%s:reconcile:%d", original.IdempotencyKey, reconcileNumber),
		ActionID:       action.ID, ExposureID: original.ExposureID, AccountID: action.AccountID,
		AttemptNumber: reconcileNumber, Phase: AttemptPhaseReconcile,
		Status: AttemptStatusBeforeSend, LegID: original.LegID,
		BookmakerID: original.BookmakerID, LobbyID: original.LobbyID,
		CollectorID: original.CollectorID, FixtureID: original.FixtureID,
		MarketID: original.MarketID, OutcomeID: original.OutcomeID,
		ProviderReference: original.ProviderReference,
		RequestedStakeVND: original.RequestedStakeVND, Version: 1,
	}
	created, isNew, err := s.attempts.Create(ctx, reconcile)
	if err != nil || !isNew {
		return err
	}
	reconcile = created
	response, _, executeErr := s.executeAttempt(ctx, &reconcile, dto.CollectorSource{
		CollectorID: original.CollectorID, BookmakerID: original.BookmakerID, LobbyID: original.LobbyID,
	}, dto.CollectorLiveBetRequest{
		Type: "reconcile_bet", ActionID: action.ID, AttemptID: reconcile.ID,
		OpportunityID: action.OpportunityID, LegID: original.LegID, AccountID: action.AccountID,
		IdempotencyKey: original.IdempotencyKey,
		ExpiresAt:      now.Add(s.cfg.CommandTimeout), TimeoutMS: int(s.cfg.CommandTimeout.Milliseconds()),
	}, false)
	if executeErr != nil || reconcile.Status == AttemptStatusAwaitingReconcile || response.Result == "submission_unknown" {
		return nil
	}
	return s.applyReconciliationResult(ctx, &action, original, response)
}

func (s *LiveExecutionService) applyReconciliationResult(
	ctx context.Context,
	action *models.BetAction,
	original *models.BetAttempt,
	response dto.CollectorLiveBetResponse,
) error {
	now := s.now().UTC()
	view, err := toView(*action)
	if err != nil {
		return err
	}
	legs := view.Legs
	if len(legs) != 2 {
		return errors.New("cannot reconcile action with incomplete legs")
	}
	applyReconciledResponse(original, response, now)
	switch response.Result {
	case "ticket_accepted":
		if response.Type != "bet_reconciled" || response.TicketID == "" ||
			response.IdempotencyKey != original.IdempotencyKey ||
			response.StakeVND != original.RequestedStakeVND ||
			!finiteMalayOdds(response.AcceptedOdds) || response.ObservedAt.IsZero() ||
			response.ObservedAt.UTC().After(now.Add(liveClockTolerance)) {
			return errors.New("reconciled ticket response is incomplete")
		}
		if original.BookmakerID == "jun88" {
			return s.openReconciledJunExposure(ctx, action, legs, original, response)
		}
		return s.completeReconciledHedge(ctx, action, legs, original, response)
	case "odds_changed", "rejected":
		updated, err := s.attempts.UpdateCAS(context.WithoutCancel(ctx), *original, original.Version)
		if err != nil {
			return err
		}
		*original = updated
		if original.BookmakerID == "jun88" {
			_, err := s.failAction(
				ctx, action, legs, StatusAbortedNoExposure,
				"jun88_reconciled_without_ticket", errors.New(errorMessage(nil, response.Error)),
			)
			return err
		}
		exposure, err := s.exposures.GetByID(ctx, action.ExposureID)
		if err != nil {
			return err
		}
		if oneOf(exposure.Status, ExposureStatusSubmissionUnknown, ExposureStatusHedging) {
			if err := TransitionBetExposure(&exposure, ExposureStatusOpen, now); err != nil {
				return err
			}
		}
		exposure.LastFailureCode = "eightxbet_reconciled_without_ticket"
		exposure.LastFailureMessage = errorMessage(nil, response.Error)
		updatedExposure, err := s.exposures.UpdateCAS(context.WithoutCancel(ctx), exposure, exposure.Version)
		if err != nil {
			return err
		}
		exposure = updatedExposure
		_, err = s.openExposure(ctx, action, legs, &exposure, exposure.LastFailureCode, errors.New(exposure.LastFailureMessage))
		return err
	default:
		return nil
	}
}

func applyReconciledResponse(
	attempt *models.BetAttempt,
	response dto.CollectorLiveBetResponse,
	at time.Time,
) {
	attempt.Status = AttemptStatusResponseReceived
	attempt.Result = response.Result
	attempt.TicketID = response.TicketID
	attempt.AcceptedOdds = response.AcceptedOdds
	attempt.AcceptedStakeVND = response.StakeVND
	attempt.SubmittedOdds = response.SubmittedOdds
	attempt.OfferedOdds = response.OfferedOdds
	attempt.ErrorMessage = response.Error
	observedAt := response.ObservedAt.UTC()
	attempt.ObservedAt = &observedAt
	attempt.ReconciledAt = &at
	attempt.ResponseReceivedAt = &at
}

func (s *LiveExecutionService) openReconciledJunExposure(
	ctx context.Context,
	action *models.BetAction,
	legs []dto.BetActionLegView,
	original *models.BetAttempt,
	response dto.CollectorLiveBetResponse,
) error {
	attempts, err := s.attempts.ListByAction(ctx, action.ID, liveAttemptQueryLimit)
	if err != nil {
		return err
	}
	var hedgePrepare *models.BetAttempt
	for index := range attempts {
		attempt := &attempts[index]
		if attempt.BookmakerID == "8xbet" && attempt.Phase == AttemptPhasePrepare &&
			attempt.Result == "prepared" && (hedgePrepare == nil || attempt.CreatedAt.After(hedgePrepare.CreatedAt)) {
			hedgePrepare = attempt
		}
	}
	if hedgePrepare == nil {
		return errors.New("cannot open reconciled Jun88 exposure without hedge target metadata")
	}
	now := s.now().UTC()
	exposure := models.BetExposure{
		BaseModel:      models.BaseModel{ID: uuid.NewString(), CreatedAt: now, UpdatedAt: now},
		IdempotencyKey: "exposure:" + action.ID + ":" + response.TicketID,
		ActionID:       action.ID, AccountID: action.AccountID, Status: ExposureStatusOpen,
		Currency: "VND", Version: 1,
		Jun88AttemptID: original.ID, Jun88TicketID: response.TicketID,
		Jun88LegID: original.LegID, Jun88FixtureID: original.FixtureID,
		Jun88MarketID: original.MarketID, Jun88OutcomeID: original.OutcomeID,
		Jun88ProviderReference: original.ProviderReference,
		Jun88AcceptedOdds:      response.AcceptedOdds, Jun88StakeVND: response.StakeVND,
		Jun88AcceptedAt:  response.ObservedAt.UTC(),
		HedgeBookmakerID: "8xbet", HedgeLegID: hedgePrepare.LegID,
		HedgeFixtureID: hedgePrepare.FixtureID, HedgeMarketID: hedgePrepare.MarketID,
		HedgeOutcomeID:         hedgePrepare.OutcomeID,
		HedgeProviderReference: hedgePrepare.ProviderReference,
		MaximumTotalStakeVND:   action.TotalStakeVND,
		HedgeMinimumStakeVND:   hedgePrepare.MinimumStakeVND,
		HedgeMaximumStakeVND:   hedgePrepare.MaximumStakeVND,
		HedgeStakeIncrementVND: hedgePrepare.StakeIncrementVND,
		OpenedAt:               now,
	}
	legs[0].Status = "ticket_received"
	legs[0].TicketID = response.TicketID
	legs[0].AcceptedOdds = response.AcceptedOdds
	legs[0].StakeVND = response.StakeVND
	action.Status = StatusJun88TicketReceived
	action.ExposureOpen = true
	action.ExposureID = exposure.ID
	action.CompletedAt = nil
	if err := encodeLiveAction(action, legs); err != nil {
		return err
	}
	original.ExposureID = exposure.ID
	event := newJournalEvent(*action, exposure.ID, "jun88_ticket_reconciled", "jun88", response.TicketID, now)
	committed, _, err := s.exposures.CommitJun88Ticket(
		context.WithoutCancel(ctx), *action, action.Version,
		*original, original.Version, exposure, event,
	)
	if err != nil {
		return err
	}
	action.Version++
	if err := s.transitionAction(ctx, action, legs, StatusExposureOpen, "exposure_open_after_reconciliation", "Jun88 ticket found by reconciliation"); err != nil {
		return err
	}
	s.publishExposure(committed)
	return nil
}

func (s *LiveExecutionService) completeReconciledHedge(
	ctx context.Context,
	action *models.BetAction,
	legs []dto.BetActionLegView,
	original *models.BetAttempt,
	response dto.CollectorLiveBetResponse,
) error {
	exposure, err := s.exposures.GetByID(ctx, action.ExposureID)
	if err != nil {
		return err
	}
	updatedAttempt, err := s.attempts.UpdateCAS(context.WithoutCancel(ctx), *original, original.Version)
	if err != nil {
		return err
	}
	*original = updatedAttempt
	exposure.HedgeAttemptID = original.ID
	exposure.HedgeTicketID = response.TicketID
	exposure.HedgeAcceptedOdds = response.AcceptedOdds
	exposure.HedgeAcceptedStakeVND = response.StakeVND
	acceptedAt := response.ObservedAt.UTC()
	exposure.HedgeAcceptedAt = &acceptedAt
	if !acceptedTicketsProfitable(exposure) {
		return errors.New("reconciled 8xbet ticket is not profitable")
	}
	if exposure.Status == ExposureStatusSubmissionUnknown {
		exposure.Status = ExposureStatusHedging
	}
	if err := TransitionBetExposure(&exposure, ExposureStatusCompleted, s.now()); err != nil {
		return err
	}
	updatedExposure, err := s.exposures.UpdateCAS(context.WithoutCancel(ctx), exposure, exposure.Version)
	if err != nil {
		return err
	}
	legs[1].Status = "ticket_received"
	legs[1].TicketID = response.TicketID
	legs[1].AcceptedOdds = response.AcceptedOdds
	legs[1].StakeVND = response.StakeVND
	if err := s.transitionAction(ctx, action, legs, StatusCompleted, "live_action_reconciled", "8xbet ticket found by reconciliation"); err != nil {
		return err
	}
	s.publishExposure(updatedExposure)
	s.releaseActionReservation(ctx, action)
	return nil
}
