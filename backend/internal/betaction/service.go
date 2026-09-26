package betaction

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"

	"surebet/backend/internal/autobet"
	"surebet/backend/internal/calculator"
	"surebet/backend/internal/config"
	"surebet/backend/internal/dto"
	"surebet/backend/internal/logger"
	"surebet/backend/internal/models"
	"surebet/backend/internal/realtime"
)

const (
	StatusSelecting                = "selecting"
	StatusReady                    = "ready"
	StatusPlacingJun88             = "placing_jun88"
	StatusJun88TicketReceived      = "jun88_ticket_received"
	StatusPlacingEightXBet         = "placing_8xbet"
	StatusCompleted                = "completed"
	StatusAwaitingOddsConfirmation = "awaiting_odds_confirmation"
	StatusExposureOpen             = "exposure_open"
	StatusSubmissionUnknown        = "submission_unknown"
	StatusSelectionRejected        = "selection_rejected"
	StatusFailed                   = "failed"

	simulatedSelectionMaxAge  = 2 * time.Second
	simulatedSelectionMaxSkew = time.Second
	simulatedClockTolerance   = time.Second
	simulatedOddsTolerance    = 0.001
)

var (
	ErrSimulationDisabled = errors.New("auto-bet simulation is disabled")
	ErrInvalidCandidate   = errors.New("invalid auto-bet simulation candidate")
	ErrInvalidRequest     = errors.New("invalid bet action request")
)

type Repository interface {
	Create(ctx context.Context, action models.BetAction) (models.BetAction, bool, error)
	UpdateCAS(ctx context.Context, action models.BetAction, expectedVersion int64) (models.BetAction, error)
	GetByID(ctx context.Context, id string) (models.BetAction, error)
	List(ctx context.Context, status string, limit int) ([]models.BetAction, error)
}

type CollectorSimulator interface {
	SimulateBet(
		ctx context.Context,
		source dto.CollectorSource,
		command dto.CollectorSimulatedBetRequest,
	) (dto.CollectorSimulatedBetResponse, error)
}

type Broadcaster interface {
	Broadcast(event realtime.Event)
}

type Service struct {
	repo        Repository
	collector   CollectorSimulator
	broadcaster Broadcaster
	cfg         config.AutoBetSimulationConfig
	log         logger.Logger
	now         func() time.Time
	control     *autobet.Control
}

func (s *Service) SetRuntimeControl(control *autobet.Control) {
	if s != nil {
		s.control = control
	}
}

func (s *Service) runtimeState() (bool, int64) {
	if s == nil {
		return false, 0
	}
	if s.control != nil {
		state := s.control.Snapshot()
		return s.cfg.Enabled && state.Enabled, state.TotalStakeVND
	}
	return s.cfg.Enabled, s.cfg.TotalStakeVND
}

type actionState struct {
	model    models.BetAction
	legs     []dto.BetActionLegView
	events   []dto.BetActionEventView
	deadline time.Time
}

func NewService(
	repo Repository,
	collector CollectorSimulator,
	cfg config.AutoBetSimulationConfig,
	broadcaster Broadcaster,
	log logger.Logger,
) *Service {
	if cfg.TotalStakeVND <= 0 {
		cfg.TotalStakeVND = 100_000
	}
	if cfg.CommandTimeout <= 0 {
		cfg.CommandTimeout = 2 * time.Second
	}
	return &Service{
		repo: repo, collector: collector, cfg: cfg, broadcaster: broadcaster, log: log,
		now: func() time.Time { return time.Now().UTC() },
	}
}

func (s *Service) Trigger(item dto.SurebetView) {
	enabled, _ := s.runtimeState()
	if s == nil || !enabled {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 4*s.cfg.CommandTimeout)
		defer cancel()
		if _, err := s.Simulate(ctx, item); err != nil && s.log != nil {
			s.log.Warn(
				"auto-bet simulation failed",
				"opportunity_id", item.ID,
				"error", err.Error(),
			)
		}
	}()
}

func (s *Service) Simulate(ctx context.Context, item dto.SurebetView) (dto.BetActionView, error) {
	enabled, totalStakeVND := s.runtimeState()
	if s == nil || !enabled {
		return dto.BetActionView{}, ErrSimulationDisabled
	}
	if s.repo == nil || s.collector == nil {
		return dto.BetActionView{}, fmt.Errorf("%w: simulation dependencies are unavailable", ErrInvalidCandidate)
	}

	now := s.now().UTC()
	deadline, err := validatedSimulationDeadline(item, now)
	if err != nil {
		return dto.BetActionView{}, err
	}
	workflowCtx, cancel := context.WithTimeout(ctx, deadline.Sub(now))
	defer cancel()
	terminalCtx := context.WithoutCancel(workflowCtx)

	legs, err := orderedSimulationLegs(item)
	if err != nil {
		return dto.BetActionView{}, err
	}
	junStake, eightXBetStake, ok := calculator.AllocateTwoWayStakeVND(
		totalStakeVND,
		legs[0].ConfirmedOdds,
		legs[1].ConfirmedOdds,
	)
	if !ok {
		return dto.BetActionView{}, fmt.Errorf("%w: confirmed odds are not a two-negative surebet", ErrInvalidCandidate)
	}
	legs[0].StakeVND = junStake
	legs[1].StakeVND = eightXBetStake

	state := actionState{
		model: models.BetAction{
			BaseModel:      models.BaseModel{ID: uuid.NewString(), CreatedAt: now, UpdatedAt: now},
			IdempotencyKey: simulationKey(item),
			OpportunityID:  item.ID,
			Mode:           "simulation",
			Status:         StatusSelecting,
			Currency:       "VND",
			TotalStakeVND:  totalStakeVND,
		},
		legs:     legs,
		deadline: deadline,
	}
	state.appendEvent("passive_confirmation_completed", StatusSelecting, "", "both collector quotes confirmed")
	if err := state.encode(); err != nil {
		return dto.BetActionView{}, err
	}
	created, isNew, err := s.repo.Create(workflowCtx, state.model)
	if err != nil {
		return dto.BetActionView{}, err
	}
	if !isNew {
		return toView(created)
	}
	state.model = created
	s.publish(state)

	if err := s.selectBoth(workflowCtx, &state); err != nil {
		return s.finishWithError(terminalCtx, &state, StatusSelectionRejected, "selection_rejected", err, false)
	}
	if err := s.validateSelectionTiming(state); err != nil {
		return s.finishWithError(terminalCtx, &state, StatusSelectionRejected, "selection_timing_invalid", err, false)
	}

	expectedReturn, ok := calculator.ValidateTwoNegativeSurebetOdds(
		state.legs[0].SelectedOdds,
		state.legs[1].SelectedOdds,
	)
	if !ok {
		return s.finishWithError(
			terminalCtx,
			&state,
			StatusSelectionRejected,
			"two_negative_rule_failed",
			errors.New("selected odds are not both negative and profitable"),
			false,
		)
	}
	junStake, eightXBetStake, ok = calculator.AllocateTwoWayStakeVND(
		totalStakeVND,
		state.legs[0].SelectedOdds,
		state.legs[1].SelectedOdds,
	)
	if !ok {
		return s.finishWithError(terminalCtx, &state, StatusSelectionRejected, "stake_allocation_failed", errors.New("selected odds cannot produce positive simulated returns"), false)
	}
	state.legs[0].StakeVND = junStake
	state.legs[1].StakeVND = eightXBetStake
	for _, leg := range state.legs {
		if leg.AvailableStake > 0 && float64(leg.StakeVND) > leg.AvailableStake {
			return s.finishWithError(terminalCtx, &state, StatusSelectionRejected, "liquidity_check_failed", fmt.Errorf("%s simulated stake exceeds known available stake", leg.BookmakerID), false)
		}
	}
	state.model.ExpectedReturn = expectedReturn
	state.model.Status = StatusReady
	state.appendEvent("odds_selected", StatusReady, "", "both simulated slips selected and revalidated")
	if err := s.persist(workflowCtx, &state); err != nil {
		return dto.BetActionView{}, err
	}

	if err := s.requireWorkflowActive(workflowCtx, state); err != nil {
		markLegError(&state, 0, "not_placed", err)
		return s.finishWithError(terminalCtx, &state, StatusFailed, "confirmation_expired_before_jun88", err, false)
	}
	junResponse, sent, err := s.place(workflowCtx, &state, 0, StatusPlacingJun88)
	if err != nil {
		if sent {
			markLegError(&state, 0, "submission_unknown", err)
			return s.finishWithError(terminalCtx, &state, StatusSubmissionUnknown, "jun88_submission_unknown", err, true)
		}
		return dto.BetActionView{}, err
	}
	switch junResponse.Result {
	case "odds_changed":
		if err := s.applyOddsChange(&state, 0, junResponse); err != nil {
			markLegError(&state, 0, "submission_unknown", err)
			return s.finishWithError(terminalCtx, &state, StatusSubmissionUnknown, "jun88_odds_change_invalid", err, true)
		}
		return s.finish(terminalCtx, &state, StatusAwaitingOddsConfirmation, false, "Jun88 returned a changed sidebar price")
	case "rejected":
		markLegError(&state, 0, "rejected", simulationResponseError(junResponse))
		return s.finishWithError(terminalCtx, &state, StatusFailed, "jun88_submission_rejected", simulationResponseError(junResponse), false)
	case "ticket_accepted":
	default:
		markLegError(&state, 0, "submission_unknown", errors.New("Jun88 returned an unknown simulated placement result"))
		return s.finishWithError(terminalCtx, &state, StatusSubmissionUnknown, "jun88_submission_unknown", errors.New("Jun88 returned an unknown simulated placement result"), true)
	}
	if err := s.applyTicket(&state, 0, junResponse); err != nil {
		markLegError(&state, 0, "submission_unknown", err)
		return s.finishWithError(terminalCtx, &state, StatusSubmissionUnknown, "jun88_ticket_invalid", err, true)
	}
	state.model.Status = StatusJun88TicketReceived
	state.appendEvent("ticket_received", StatusJun88TicketReceived, "jun88", junResponse.TicketID)
	if err := s.persist(workflowCtx, &state); err != nil {
		return dto.BetActionView{}, err
	}

	if err := s.requireWorkflowActive(workflowCtx, state); err != nil {
		markLegError(&state, 1, "not_placed", err)
		return s.finishWithError(terminalCtx, &state, StatusExposureOpen, "confirmation_expired_before_eightxbet", err, true)
	}
	eightXBetResponse, sent, err := s.place(workflowCtx, &state, 1, StatusPlacingEightXBet)
	if err != nil {
		if sent {
			markLegError(&state, 1, "submission_unknown", err)
			return s.finishWithError(terminalCtx, &state, StatusSubmissionUnknown, "eightxbet_submission_unknown", err, true)
		}
		return dto.BetActionView{}, err
	}
	switch eightXBetResponse.Result {
	case "odds_changed":
		if err := s.applyOddsChange(&state, 1, eightXBetResponse); err != nil {
			markLegError(&state, 1, "submission_unknown", err)
			return s.finishWithError(terminalCtx, &state, StatusSubmissionUnknown, "eightxbet_odds_change_invalid", err, true)
		}
		return s.finish(terminalCtx, &state, StatusExposureOpen, true, "8xbet changed odds after the Jun88 ticket was received")
	case "rejected":
		markLegError(&state, 1, "rejected", simulationResponseError(eightXBetResponse))
		return s.finishWithError(terminalCtx, &state, StatusExposureOpen, "eightxbet_submission_rejected", simulationResponseError(eightXBetResponse), true)
	case "ticket_accepted":
	default:
		markLegError(&state, 1, "submission_unknown", errors.New("8xbet returned an unknown simulated placement result"))
		return s.finishWithError(terminalCtx, &state, StatusSubmissionUnknown, "eightxbet_submission_unknown", errors.New("8xbet returned an unknown simulated placement result"), true)
	}
	if err := s.applyTicket(&state, 1, eightXBetResponse); err != nil {
		markLegError(&state, 1, "submission_unknown", err)
		return s.finishWithError(terminalCtx, &state, StatusSubmissionUnknown, "eightxbet_ticket_invalid", err, true)
	}
	if !acceptedPairProfitable(state) {
		markLegError(&state, 1, "ticket_received", errors.New("accepted pair is not profitable"))
		return s.finishWithError(terminalCtx, &state, StatusExposureOpen, "accepted_pair_not_profitable", errors.New("accepted simulated tickets do not preserve a positive two-way return"), true)
	}
	state.appendEvent("ticket_received", StatusCompleted, "8xbet", eightXBetResponse.TicketID)
	return s.finish(terminalCtx, &state, StatusCompleted, false, "both simulated tickets received")
}

func (s *Service) selectBoth(ctx context.Context, state *actionState) error {
	type result struct {
		index    int
		response dto.CollectorSimulatedBetResponse
		err      error
	}
	results := make(chan result, len(state.legs))
	for index := range state.legs {
		index := index
		go func() {
			response, err := s.send(ctx, state, index, "simulate_select_odds")
			results <- result{index: index, response: response, err: err}
		}()
	}
	for range state.legs {
		result := <-results
		if result.err != nil {
			return result.err
		}
		if err := applySelectedQuote(&state.legs[result.index], result.response); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) place(
	ctx context.Context,
	state *actionState,
	index int,
	status string,
) (dto.CollectorSimulatedBetResponse, bool, error) {
	if err := s.requireWorkflowActive(ctx, *state); err != nil {
		return dto.CollectorSimulatedBetResponse{}, false, err
	}
	state.model.Status = status
	state.legs[index].Status = "placing"
	state.appendEvent("placing", status, state.legs[index].BookmakerID, "simulation command sent")
	if err := s.persist(ctx, state); err != nil {
		return dto.CollectorSimulatedBetResponse{}, false, err
	}
	response, err := s.send(ctx, state, index, "simulate_place_bet")
	return response, true, err
}

func (s *Service) send(
	ctx context.Context,
	state *actionState,
	index int,
	commandType string,
) (dto.CollectorSimulatedBetResponse, error) {
	leg := state.legs[index]
	expiresAt := s.now().UTC().Add(s.cfg.CommandTimeout)
	if state.deadline.Before(expiresAt) {
		expiresAt = state.deadline
	}
	remaining := expiresAt.Sub(s.now().UTC())
	if remaining <= 0 {
		return dto.CollectorSimulatedBetResponse{}, errors.New("confirmed surebet deadline expired before simulated command")
	}
	timeoutCtx, cancel := context.WithTimeout(ctx, remaining)
	defer cancel()
	command := dto.CollectorSimulatedBetRequest{
		Type:          commandType,
		ActionID:      state.model.ID,
		OpportunityID: state.model.OpportunityID,
		LegID:         leg.LegID,
		Sequence:      leg.Sequence,
		FixtureID:     leg.FixtureID,
		MarketID:      leg.MarketID,
		OutcomeID:     leg.OutcomeID,
		ExpectedOdds:  selectedOrConfirmedOdds(leg),
		StakeVND:      leg.StakeVND,
		ExpiresAt:     expiresAt,
		TimeoutMS:     int(s.cfg.CommandTimeout.Milliseconds()),
	}
	if commandType == "simulate_place_bet" {
		command.IdempotencyKey = state.model.ID + ":" + leg.BookmakerID + ":place"
	}
	return s.collector.SimulateBet(timeoutCtx, sourceForLeg(leg), command)
}

func applySelectedQuote(leg *dto.BetActionLegView, response dto.CollectorSimulatedBetResponse) error {
	selection := response.Selection
	if response.Result != "selected" || selection == nil || selection.Suspended {
		return fmt.Errorf("%s simulated selection is unavailable", leg.BookmakerID)
	}
	if selection.FixtureID != leg.FixtureID || selection.MarketID != leg.MarketID || selection.OutcomeID != leg.OutcomeID {
		return fmt.Errorf("%s simulated selection identity changed", leg.BookmakerID)
	}
	if !finiteNonZero(selection.Odds) {
		return fmt.Errorf("%s simulated selection odds are invalid", leg.BookmakerID)
	}
	if response.ObservedAt.IsZero() {
		return fmt.Errorf("%s simulated selection observation time is missing", leg.BookmakerID)
	}
	if !simulatedSelectionProvenanceValid(leg.BookmakerID, *selection) {
		return fmt.Errorf("%s simulated selection odds format or provenance is invalid", leg.BookmakerID)
	}
	if math.IsNaN(selection.AvailableStake) || math.IsInf(selection.AvailableStake, 0) || selection.AvailableStake < 0 {
		return fmt.Errorf("%s simulated available stake is invalid", leg.BookmakerID)
	}
	leg.SelectedOdds = selection.Odds
	leg.AvailableStake = selection.AvailableStake
	leg.ObservedAt = response.ObservedAt.UTC()
	leg.Status = "selected"
	return nil
}

func (s *Service) applyTicket(state *actionState, index int, response dto.CollectorSimulatedBetResponse) error {
	leg := &state.legs[index]
	if response.Result != "ticket_accepted" || strings.TrimSpace(response.TicketID) == "" ||
		!finiteMalayOdds(response.AcceptedOdds) || response.StakeVND != leg.StakeVND ||
		math.Abs(response.AcceptedOdds-selectedOrConfirmedOdds(*leg)) > simulatedOddsTolerance ||
		!s.freshResponse(response.ObservedAt) {
		return errors.New("simulated ticket response is incomplete")
	}
	leg.Status = "ticket_received"
	leg.TicketID = response.TicketID
	leg.AcceptedOdds = response.AcceptedOdds
	leg.ObservedAt = response.ObservedAt.UTC()
	return nil
}

func (s *Service) applyOddsChange(
	state *actionState,
	index int,
	response dto.CollectorSimulatedBetResponse,
) error {
	leg := &state.legs[index]
	if response.Result != "odds_changed" || !response.ConfirmationRequired ||
		!finiteMalayOdds(response.OfferedOdds) ||
		math.Abs(response.SubmittedOdds-selectedOrConfirmedOdds(*leg)) > simulatedOddsTolerance ||
		math.Abs(response.OfferedOdds-response.SubmittedOdds) <= simulatedOddsTolerance ||
		!s.freshResponse(response.ObservedAt) {
		return errors.New("simulated odds-change response is invalid")
	}
	leg.Status = "odds_changed"
	leg.OfferedOdds = response.OfferedOdds
	leg.ConfirmationRequired = true
	leg.ObservedAt = response.ObservedAt.UTC()
	otherOdds := selectedOrConfirmedOdds(state.legs[1-index])
	var eligible bool
	if index == 0 {
		leg.OfferedExpectedReturn, eligible = calculator.ValidateTwoNegativeSurebetOdds(response.OfferedOdds, otherOdds)
	} else {
		leg.OfferedExpectedReturn, eligible = calculator.ValidateTwoNegativeSurebetOdds(otherOdds, response.OfferedOdds)
	}
	leg.OfferedPairEligible = &eligible
	state.appendEvent("odds_changed", state.model.Status, leg.BookmakerID, fmt.Sprintf("%.4f -> %.4f", response.SubmittedOdds, response.OfferedOdds))
	return nil
}

func (s *Service) finish(
	ctx context.Context,
	state *actionState,
	status string,
	exposure bool,
	message string,
) (dto.BetActionView, error) {
	now := s.now().UTC()
	state.model.Status = status
	state.model.ExposureOpen = exposure
	if isTerminalActionStatus(status) {
		state.model.CompletedAt = &now
	} else {
		state.model.CompletedAt = nil
	}
	state.appendEvent("simulation_finished", status, "", message)
	if err := s.persist(ctx, state); err != nil {
		return dto.BetActionView{}, err
	}
	return state.view(), nil
}

func (s *Service) finishWithError(
	ctx context.Context,
	state *actionState,
	status, code string,
	err error,
	exposure bool,
) (dto.BetActionView, error) {
	state.model.ErrorCode = code
	state.model.ErrorMessage = err.Error()
	view, persistErr := s.finish(ctx, state, status, exposure, err.Error())
	if persistErr != nil {
		return dto.BetActionView{}, persistErr
	}
	return view, nil
}

func (s *Service) Get(ctx context.Context, id string) (dto.BetActionView, error) {
	action, err := s.repo.GetByID(ctx, strings.TrimSpace(id))
	if err != nil {
		return dto.BetActionView{}, err
	}
	return toView(action)
}

func (s *Service) List(ctx context.Context, status string, limit int) ([]dto.BetActionView, error) {
	status = strings.TrimSpace(status)
	if status != "" && !validStatus(status) {
		return nil, fmt.Errorf("%w: unsupported status %q", ErrInvalidRequest, status)
	}
	if limit <= 0 {
		limit = 100
	}
	if limit > 500 {
		limit = 500
	}
	actions, err := s.repo.List(ctx, status, limit)
	if err != nil {
		return nil, err
	}
	views := make([]dto.BetActionView, 0, len(actions))
	for _, action := range actions {
		view, err := toView(action)
		if err != nil {
			return nil, err
		}
		views = append(views, view)
	}
	return views, nil
}

func (s *Service) persist(ctx context.Context, state *actionState) error {
	state.model.UpdatedAt = s.now().UTC()
	if err := state.encode(); err != nil {
		return err
	}
	updated, err := s.repo.UpdateCAS(ctx, state.model, state.model.Version)
	if err != nil {
		return err
	}
	state.model = updated
	s.publish(*state)
	return nil
}

func (s *Service) publish(state actionState) {
	if s.broadcaster == nil {
		return
	}
	s.broadcaster.Broadcast(realtime.Event{
		Type:    "auto_bet_simulation_updated",
		SentAt:  s.now().UTC(),
		Payload: state.view(),
	})
}

func (s *actionState) encode() error {
	legs, err := json.Marshal(s.legs)
	if err != nil {
		return err
	}
	events, err := json.Marshal(s.events)
	if err != nil {
		return err
	}
	s.model.Legs = legs
	s.model.Events = events
	return nil
}

func (s *actionState) appendEvent(eventType, status, bookmakerID, message string) {
	s.events = append(s.events, dto.BetActionEventView{
		Sequence: len(s.events) + 1, Type: eventType, Status: status,
		BookmakerID: bookmakerID, Message: message, OccurredAt: time.Now().UTC(),
	})
}

func (s actionState) view() dto.BetActionView {
	return dto.BetActionView{
		ActionID: s.model.ID, IdempotencyKey: s.model.IdempotencyKey,
		OpportunityID: s.model.OpportunityID, AccountID: s.model.AccountID,
		ConfirmationRevision: s.model.ConfirmationRevision,
		Mode:                 s.model.Mode, Status: s.model.Status,
		Currency: s.model.Currency, TotalStakeVND: s.model.TotalStakeVND,
		ExpectedReturn: s.model.ExpectedReturn, Legs: append([]dto.BetActionLegView(nil), s.legs...),
		Events: append([]dto.BetActionEventView(nil), s.events...), ExposureOpen: s.model.ExposureOpen,
		ExposureID: s.model.ExposureID, RepriceRevision: s.model.RepriceRevision,
		ReservedStakeVND: s.model.ReservedStakeVND, ReservationExpiresAt: s.model.ReservationExpiresAt,
		Version: s.model.Version, LeaseOwner: s.model.LeaseOwner, LeaseExpiresAt: s.model.LeaseExpiresAt,
		CreatedAt: s.model.CreatedAt, UpdatedAt: s.model.UpdatedAt, CompletedAt: s.model.CompletedAt,
		ErrorCode: s.model.ErrorCode, ErrorMessage: s.model.ErrorMessage,
	}
}

func toView(action models.BetAction) (dto.BetActionView, error) {
	state := actionState{model: action}
	if err := json.Unmarshal(action.Legs, &state.legs); err != nil {
		return dto.BetActionView{}, fmt.Errorf("decode bet action legs: %w", err)
	}
	if err := json.Unmarshal(action.Events, &state.events); err != nil {
		return dto.BetActionView{}, fmt.Errorf("decode bet action events: %w", err)
	}
	return state.view(), nil
}

func validatedSimulationDeadline(item dto.SurebetView, now time.Time) (time.Time, error) {
	if !strings.EqualFold(strings.TrimSpace(item.VerificationStatus), "confirmed") ||
		item.ConfirmedAt.IsZero() {
		return time.Time{}, fmt.Errorf("%w: opportunity is not hard-confirmed", ErrInvalidCandidate)
	}
	deadline := item.ValidUntil.UTC()
	if deadline.IsZero() {
		deadline = item.ExpiresAt.UTC()
	}
	if deadline.IsZero() || !deadline.After(now) {
		return time.Time{}, fmt.Errorf("%w: confirmed opportunity has expired", ErrInvalidCandidate)
	}
	return deadline, nil
}

func (s *Service) requireWorkflowActive(ctx context.Context, state actionState) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if !state.deadline.After(s.now().UTC()) {
		return errors.New("confirmed surebet deadline has expired")
	}
	return nil
}

func (s *Service) validateSelectionTiming(state actionState) error {
	if len(state.legs) != 2 {
		return errors.New("simulated selection pair is incomplete")
	}
	now := s.now().UTC()
	for _, leg := range state.legs {
		if leg.ObservedAt.IsZero() {
			return fmt.Errorf("%s simulated selection observation time is missing", leg.BookmakerID)
		}
		age := now.Sub(leg.ObservedAt.UTC())
		if age < -simulatedClockTolerance || age > simulatedSelectionMaxAge {
			return fmt.Errorf("%s simulated selection is stale", leg.BookmakerID)
		}
	}
	if absoluteDuration(state.legs[0].ObservedAt.Sub(state.legs[1].ObservedAt)) > simulatedSelectionMaxSkew {
		return errors.New("simulated selection pair exceeds the maximum observation skew")
	}
	return nil
}

func (s *Service) freshResponse(observedAt time.Time) bool {
	if observedAt.IsZero() {
		return false
	}
	age := s.now().UTC().Sub(observedAt.UTC())
	return age >= -simulatedClockTolerance && age <= simulatedSelectionMaxAge
}

func simulatedSelectionProvenanceValid(
	bookmakerID string,
	selection dto.CollectorConfirmedSelection,
) bool {
	switch bookmakerID {
	case "8xbet":
		if selection.OddsFormat != "indonesian" || selection.RawOdds <= 0 || selection.SourceEventID == "" {
			return false
		}
		expected := selection.RawOdds
		if expected > 1 {
			expected = -1 / expected
		}
		expected = math.Round(expected*100) / 100
		return math.Abs(expected-selection.Odds) <= simulatedOddsTolerance
	case "jun88":
		return selection.OddsFormat == "malay" && selection.SourceEventID != "" &&
			math.Abs(selection.RawOdds-selection.Odds) <= simulatedOddsTolerance
	default:
		return false
	}
}

func acceptedPairProfitable(state actionState) bool {
	if len(state.legs) != 2 {
		return false
	}
	left := state.legs[0]
	right := state.legs[1]
	if _, ok := calculator.ValidateTwoNegativeSurebetOdds(left.AcceptedOdds, right.AcceptedOdds); !ok {
		return false
	}
	total := float64(left.StakeVND + right.StakeVND)
	leftDecimal, leftOK := malayDecimalOdds(left.AcceptedOdds)
	rightDecimal, rightOK := malayDecimalOdds(right.AcceptedOdds)
	return leftOK && rightOK &&
		float64(left.StakeVND)*leftDecimal-total > 0 &&
		float64(right.StakeVND)*rightDecimal-total > 0
}

func malayDecimalOdds(value float64) (float64, bool) {
	if !finiteMalayOdds(value) {
		return 0, false
	}
	var decimal float64
	if value > 0 {
		decimal = 1 + value
	} else {
		decimal = 1 + (1 / math.Abs(value))
	}
	if math.IsNaN(decimal) || math.IsInf(decimal, 0) || decimal <= 1 {
		return 0, false
	}
	return decimal, true
}

func finiteMalayOdds(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0) && value != 0 && value >= -1 && value <= 1
}

func simulationResponseError(response dto.CollectorSimulatedBetResponse) error {
	if message := strings.TrimSpace(response.Error); message != "" {
		return errors.New(message)
	}
	return fmt.Errorf("collector returned simulated placement result %q", response.Result)
}

func markLegError(state *actionState, index int, status string, err error) {
	if state == nil || index < 0 || index >= len(state.legs) {
		return
	}
	state.legs[index].Status = status
	if err != nil {
		state.legs[index].Error = err.Error()
	}
}

func absoluteDuration(value time.Duration) time.Duration {
	if value < 0 {
		return -value
	}
	return value
}

func orderedSimulationLegs(item dto.SurebetView) ([]dto.BetActionLegView, error) {
	if item.ID == "" || len(item.Legs) != 2 || item.MatchAmbiguous {
		return nil, fmt.Errorf("%w: opportunity must contain exactly two unambiguous legs", ErrInvalidCandidate)
	}
	result := make([]dto.BetActionLegView, 2)
	found := [2]bool{}
	for _, leg := range item.Legs {
		index := -1
		switch {
		case leg.BookmakerID == "jun88" && leg.LobbyID == "cmd":
			index = 0
		case leg.BookmakerID == "8xbet" && leg.LobbyID == "default":
			index = 1
		}
		if index < 0 || found[index] {
			return nil, fmt.Errorf("%w: requires one jun88/cmd and one 8xbet/default leg", ErrInvalidCandidate)
		}
		found[index] = true
		result[index] = dto.BetActionLegView{
			LegID: legIdentity(leg), Sequence: index + 1,
			BookmakerID: leg.BookmakerID, LobbyID: leg.LobbyID,
			FixtureID: leg.FixtureID, MarketID: leg.MarketID,
			OutcomeID: leg.OutcomeID, OutcomeName: leg.OutcomeName,
			ConfirmedOdds: leg.Odds, Status: "pending",
		}
	}
	if !found[0] || !found[1] {
		return nil, fmt.Errorf("%w: both required collectors are missing", ErrInvalidCandidate)
	}
	return result, nil
}

func simulationKey(item dto.SurebetView) string {
	parts := make([]string, 0, len(item.Legs))
	for _, leg := range item.Legs {
		parts = append(parts, fmt.Sprintf(
			"%s|%.8f",
			legIdentity(leg),
			leg.Odds,
		))
	}
	sort.Strings(parts)
	digest := sha256.Sum256([]byte(item.ID + "|" + strings.Join(parts, "|")))
	return "simulation:" + hex.EncodeToString(digest[:])
}

func legIdentity(leg dto.SurebetLegView) string {
	return strings.Join([]string{leg.BookmakerID, leg.LobbyID, leg.FixtureID, leg.MarketID, leg.OutcomeID}, ":")
}

func sourceForLeg(leg dto.BetActionLegView) dto.CollectorSource {
	collectorID := leg.BookmakerID
	if leg.BookmakerID == "jun88" {
		collectorID = "jun88-cmd"
	}
	return dto.CollectorSource{CollectorID: collectorID, BookmakerID: leg.BookmakerID, LobbyID: leg.LobbyID}
}

func selectedOrConfirmedOdds(leg dto.BetActionLegView) float64 {
	if finiteNonZero(leg.SelectedOdds) {
		return leg.SelectedOdds
	}
	return leg.ConfirmedOdds
}

func finiteNonZero(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0) && value != 0
}

func validStatus(status string) bool {
	switch status {
	case StatusSelecting, StatusReady, StatusPlacingJun88, StatusJun88TicketReceived,
		StatusPlacingEightXBet, StatusCompleted, StatusAwaitingOddsConfirmation,
		StatusExposureOpen, StatusSubmissionUnknown, StatusSelectionRejected, StatusFailed,
		StatusAbortedNoExposure, StatusUnhedgedClosed, StatusDryRunCompleted:
		return true
	default:
		return false
	}
}
