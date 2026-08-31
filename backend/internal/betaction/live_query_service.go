package betaction

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"surebet/backend/internal/dto"
	"surebet/backend/internal/models"
)

type ExposureQueryRepository interface {
	GetByID(ctx context.Context, id string) (models.BetExposure, error)
	List(ctx context.Context, status string, limit int) ([]models.BetExposure, error)
}

type AttemptQueryRepository interface {
	ListByAction(ctx context.Context, actionID string, limit int) ([]models.BetAttempt, error)
	ListByExposure(ctx context.Context, exposureID string, limit int) ([]models.BetAttempt, error)
}

type EventQueryRepository interface {
	ListByAction(ctx context.Context, actionID string, afterSequence int64, limit int) ([]models.BetActionEvent, error)
}

type LiveQueryService struct {
	exposures ExposureQueryRepository
	attempts  AttemptQueryRepository
	events    EventQueryRepository
}

func NewLiveQueryService(
	exposures ExposureQueryRepository,
	attempts AttemptQueryRepository,
	events EventQueryRepository,
) *LiveQueryService {
	return &LiveQueryService{exposures: exposures, attempts: attempts, events: events}
}

func (s *LiveQueryService) GetExposure(ctx context.Context, id string) (dto.BetExposureView, error) {
	if s == nil || s.exposures == nil || strings.TrimSpace(id) == "" {
		return dto.BetExposureView{}, ErrInvalidRequest
	}
	exposure, err := s.exposures.GetByID(ctx, strings.TrimSpace(id))
	if err != nil {
		return dto.BetExposureView{}, err
	}
	return ToBetExposureView(exposure), nil
}

func (s *LiveQueryService) ListExposures(
	ctx context.Context,
	status string,
	limit int,
) ([]dto.BetExposureView, error) {
	if s == nil || s.exposures == nil {
		return nil, ErrInvalidRequest
	}
	status = strings.TrimSpace(status)
	if status != "" && !validExposureStatus(status) {
		return nil, fmt.Errorf("%w: unsupported exposure status %q", ErrInvalidRequest, status)
	}
	limit = boundedLiveQueryLimit(limit)
	exposures, err := s.exposures.List(ctx, status, limit)
	if err != nil {
		return nil, err
	}
	views := make([]dto.BetExposureView, len(exposures))
	for index, exposure := range exposures {
		views[index] = ToBetExposureView(exposure)
	}
	return views, nil
}

// ListAttempts requires exactly one owner filter so an internal endpoint
// cannot accidentally scan the complete command history.
func (s *LiveQueryService) ListAttempts(
	ctx context.Context,
	actionID, exposureID string,
	limit int,
) ([]dto.BetAttemptView, error) {
	if s == nil || s.attempts == nil {
		return nil, ErrInvalidRequest
	}
	actionID = strings.TrimSpace(actionID)
	exposureID = strings.TrimSpace(exposureID)
	if (actionID == "") == (exposureID == "") {
		return nil, fmt.Errorf("%w: exactly one of action_id or exposure_id is required", ErrInvalidRequest)
	}
	var (
		attempts []models.BetAttempt
		err      error
	)
	limit = boundedLiveQueryLimit(limit)
	if actionID != "" {
		attempts, err = s.attempts.ListByAction(ctx, actionID, limit)
	} else {
		attempts, err = s.attempts.ListByExposure(ctx, exposureID, limit)
	}
	if err != nil {
		return nil, err
	}
	views := make([]dto.BetAttemptView, len(attempts))
	for index, attempt := range attempts {
		views[index] = ToBetAttemptView(attempt)
	}
	return views, nil
}

func (s *LiveQueryService) ListEvents(
	ctx context.Context,
	actionID string,
	afterSequence int64,
	limit int,
) ([]dto.BetActionJournalEventView, error) {
	if s == nil || s.events == nil || strings.TrimSpace(actionID) == "" || afterSequence < 0 {
		return nil, ErrInvalidRequest
	}
	events, err := s.events.ListByAction(
		ctx,
		strings.TrimSpace(actionID),
		afterSequence,
		boundedLiveQueryLimit(limit),
	)
	if err != nil {
		return nil, err
	}
	views := make([]dto.BetActionJournalEventView, len(events))
	for index, event := range events {
		views[index] = ToBetActionJournalEventView(event)
	}
	return views, nil
}

func ToBetAttemptView(attempt models.BetAttempt) dto.BetAttemptView {
	return dto.BetAttemptView{
		AttemptID: attempt.ID, IdempotencyKey: attempt.IdempotencyKey,
		ActionID: attempt.ActionID, ExposureID: attempt.ExposureID, AccountID: attempt.AccountID,
		AttemptNumber: attempt.AttemptNumber, Phase: attempt.Phase, Status: attempt.Status,
		Result: attempt.Result, RequestID: attempt.RequestID, SessionID: attempt.SessionID,
		SessionGeneration: attempt.SessionGeneration, LegID: attempt.LegID,
		CollectorID: attempt.CollectorID, BookmakerID: attempt.BookmakerID, LobbyID: attempt.LobbyID,
		FixtureID: attempt.FixtureID, MarketID: attempt.MarketID, OutcomeID: attempt.OutcomeID,
		ProviderReference: attempt.ProviderReference, PrepareID: attempt.PrepareID,
		SlipFingerprint: attempt.SlipFingerprint, QuoteRevision: attempt.QuoteRevision,
		OddsFormat: attempt.OddsFormat, RawOdds: attempt.RawOdds, ExpectedOdds: attempt.ExpectedOdds,
		SubmittedOdds: attempt.SubmittedOdds, OfferedOdds: attempt.OfferedOdds,
		AcceptedOdds: attempt.AcceptedOdds, RequestedStakeVND: attempt.RequestedStakeVND,
		AcceptedStakeVND: attempt.AcceptedStakeVND, MinimumStakeVND: attempt.MinimumStakeVND,
		MaximumStakeVND: attempt.MaximumStakeVND, StakeIncrementVND: attempt.StakeIncrementVND,
		BalanceVND: attempt.BalanceVND, TicketID: attempt.TicketID, ExpiresAt: attempt.ExpiresAt,
		RawResponseHash: attempt.RawResponseHash,
		ObservedAt:      attempt.ObservedAt, SubmitStartedAt: attempt.SubmitStartedAt,
		ResponseReceivedAt: attempt.ResponseReceivedAt, ReconciledAt: attempt.ReconciledAt,
		Version: attempt.Version, ErrorCode: attempt.ErrorCode, ErrorMessage: attempt.ErrorMessage,
		CreatedAt: attempt.CreatedAt, UpdatedAt: attempt.UpdatedAt,
	}
}

func ToBetExposureView(exposure models.BetExposure) dto.BetExposureView {
	return dto.BetExposureView{
		ExposureID: exposure.ID, IdempotencyKey: exposure.IdempotencyKey,
		ActionID: exposure.ActionID, AccountID: exposure.AccountID,
		Status: exposure.Status, Currency: exposure.Currency, Version: exposure.Version,
		LeaseOwner: exposure.LeaseOwner, LeaseExpiresAt: exposure.LeaseExpiresAt,
		Jun88AttemptID: exposure.Jun88AttemptID, Jun88TicketID: exposure.Jun88TicketID,
		Jun88LegID: exposure.Jun88LegID, Jun88FixtureID: exposure.Jun88FixtureID,
		Jun88MarketID: exposure.Jun88MarketID, Jun88OutcomeID: exposure.Jun88OutcomeID,
		Jun88ProviderReference: exposure.Jun88ProviderReference,
		Jun88AcceptedOdds:      exposure.Jun88AcceptedOdds, Jun88StakeVND: exposure.Jun88StakeVND,
		Jun88AcceptedAt: exposure.Jun88AcceptedAt, HedgeBookmakerID: exposure.HedgeBookmakerID,
		HedgeLegID: exposure.HedgeLegID, HedgeFixtureID: exposure.HedgeFixtureID,
		HedgeMarketID: exposure.HedgeMarketID, HedgeOutcomeID: exposure.HedgeOutcomeID,
		HedgeProviderReference:  exposure.HedgeProviderReference,
		MaximumTotalStakeVND:    exposure.MaximumTotalStakeVND,
		HedgeMinimumStakeVND:    exposure.HedgeMinimumStakeVND,
		HedgeMaximumStakeVND:    exposure.HedgeMaximumStakeVND,
		HedgeStakeIncrementVND:  exposure.HedgeStakeIncrementVND,
		CurrentHedgeOdds:        exposure.CurrentHedgeOdds,
		RequiredHedgeStakeVND:   exposure.RequiredHedgeStakeVND,
		ProjectedJunProfitVND:   exposure.ProjectedJunProfitVND,
		ProjectedHedgeProfitVND: exposure.ProjectedHedgeProfitVND,
		LastQuoteRevision:       exposure.LastQuoteRevision,
		LastQuoteObservedAt:     exposure.LastQuoteObservedAt, NextEvaluationAt: exposure.NextEvaluationAt,
		HedgeAttemptID: exposure.HedgeAttemptID, HedgeTicketID: exposure.HedgeTicketID,
		HedgeAcceptedOdds:     exposure.HedgeAcceptedOdds,
		HedgeAcceptedStakeVND: exposure.HedgeAcceptedStakeVND,
		HedgeAcceptedAt:       exposure.HedgeAcceptedAt, OpenedAt: exposure.OpenedAt,
		CompletedAt: exposure.CompletedAt, ClosedAt: exposure.ClosedAt,
		MarketClosedAt: exposure.MarketClosedAt, LastFailureCode: exposure.LastFailureCode,
		LastFailureMessage: exposure.LastFailureMessage,
		CreatedAt:          exposure.CreatedAt, UpdatedAt: exposure.UpdatedAt,
	}
}

func ToBetActionJournalEventView(event models.BetActionEvent) dto.BetActionJournalEventView {
	metadata := json.RawMessage(event.Metadata)
	if !json.Valid(metadata) {
		metadata = json.RawMessage("{}")
	}
	return dto.BetActionJournalEventView{
		EventID: event.ID, ActionID: event.ActionID, ExposureID: event.ExposureID,
		Sequence: event.Sequence, Type: event.Type, Status: event.Status,
		BookmakerID: event.BookmakerID, Message: event.Message,
		Metadata: metadata, OccurredAt: event.OccurredAt,
	}
}

func boundedLiveQueryLimit(limit int) int {
	if limit <= 0 {
		return 100
	}
	if limit > 500 {
		return 500
	}
	return limit
}

func validExposureStatus(status string) bool {
	switch status {
	case ExposureStatusOpen, ExposureStatusHedging, ExposureStatusSubmissionUnknown,
		ExposureStatusCompleted, ExposureStatusUnhedgedClosed, ExposureStatusManualReview:
		return true
	default:
		return false
	}
}
