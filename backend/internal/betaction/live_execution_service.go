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
	"surebet/backend/internal/config"
	"surebet/backend/internal/dto"
	"surebet/backend/internal/logger"
	"surebet/backend/internal/models"
	"surebet/backend/internal/realtime"
)

const (
	liveProtocolVersion   = 4
	livePreparedMaxAge    = 2 * time.Second
	livePreparedMaxSkew   = time.Second
	liveClockTolerance    = time.Second
	liveOddsTolerance     = 0.001
	liveAttemptQueryLimit = 500
)

var (
	ErrLiveExecutionDisabled = errors.New("live auto-bet is disabled")
	ErrInvalidLiveCandidate  = errors.New("invalid live auto-bet candidate")
	ErrLiveRiskGate          = errors.New("live auto-bet risk gate rejected the action")
)

type LiveCollector interface {
	ExecuteLiveBet(
		ctx context.Context,
		source dto.CollectorSource,
		command dto.CollectorLiveBetRequest,
	) (dto.CollectorLiveBetResponse, bool, error)
}

type LiveActionRepository interface {
	Create(ctx context.Context, action models.BetAction) (models.BetAction, bool, error)
	UpdateCAS(ctx context.Context, action models.BetAction, expectedVersion int64) (models.BetAction, error)
	TryReserveAccountStake(ctx context.Context, id, accountID, owner string, expectedVersion, stakeVND int64, now, expiresAt time.Time) (models.BetAction, bool, error)
	ReleaseAccountStake(ctx context.Context, id, accountID, owner string, expectedVersion int64, now time.Time) (models.BetAction, error)
	GetByID(ctx context.Context, id string) (models.BetAction, error)
	List(ctx context.Context, status string, limit int) ([]models.BetAction, error)
}

type LiveAttemptRepository interface {
	Create(ctx context.Context, attempt models.BetAttempt) (models.BetAttempt, bool, error)
	UpdateCAS(ctx context.Context, attempt models.BetAttempt, expectedVersion int64) (models.BetAttempt, error)
	ListByAction(ctx context.Context, actionID string, limit int) ([]models.BetAttempt, error)
}

type LiveExposureRepository interface {
	UpdateCAS(ctx context.Context, exposure models.BetExposure, expectedVersion int64) (models.BetExposure, error)
	TryAcquireLease(ctx context.Context, id, owner string, expectedVersion int64, now, expiresAt time.Time) (models.BetExposure, bool, error)
	ReleaseLease(ctx context.Context, id, owner string, expectedVersion int64, now time.Time) (models.BetExposure, error)
	GetByID(ctx context.Context, id string) (models.BetExposure, error)
	List(ctx context.Context, status string, limit int) ([]models.BetExposure, error)
	ListDue(ctx context.Context, now time.Time, limit int) ([]models.BetExposure, error)
	CommitJun88Ticket(
		ctx context.Context,
		action models.BetAction,
		expectedActionVersion int64,
		attempt models.BetAttempt,
		expectedAttemptVersion int64,
		exposure models.BetExposure,
		event models.BetActionEvent,
	) (models.BetExposure, bool, error)
}

type LiveEventRepository interface {
	Append(ctx context.Context, event models.BetActionEvent) (models.BetActionEvent, bool, error)
}

type LiveExecutionService struct {
	actions     LiveActionRepository
	attempts    LiveAttemptRepository
	exposures   LiveExposureRepository
	events      LiveEventRepository
	collector   LiveCollector
	broadcaster Broadcaster
	cfg         config.AutoBetLiveConfig
	log         logger.Logger
	now         func() time.Time
	owner       string
	control     *autobet.Control
}

func (s *LiveExecutionService) SetRuntimeControl(control *autobet.Control) {
	if s != nil {
		s.control = control
	}
}

func (s *LiveExecutionService) runtimeState() (bool, int64) {
	if s == nil {
		return false, 0
	}
	if s.control != nil {
		state := s.control.Snapshot()
		return s.cfg.Enabled && state.Enabled, state.TotalStakeVND
	}
	return s.cfg.Enabled, s.cfg.TotalStakeVND
}

func (s *LiveExecutionService) runtimeEnabled() bool {
	enabled, _ := s.runtimeState()
	return enabled
}

func (s *LiveExecutionService) runtimeTotalStakeVND() int64 {
	_, total := s.runtimeState()
	if total > 0 {
		return total
	}
	return s.cfg.TotalStakeVND
}

func (s *LiveExecutionService) disableForRisk(reason string) {
	if s == nil || s.control == nil {
		return
	}
	state := s.control.Disable()
	if s.log != nil {
		s.log.Warn("live auto-bet disabled by risk gate", "reason", reason, "total_stake_vnd", state.TotalStakeVND)
	}
}

type preparedLiveLeg struct {
	index    int
	leg      dto.SurebetLegView
	view     dto.BetActionLegView
	attempt  models.BetAttempt
	response dto.CollectorLiveBetResponse
}

func NewLiveExecutionService(
	actions LiveActionRepository,
	attempts LiveAttemptRepository,
	exposures LiveExposureRepository,
	events LiveEventRepository,
	collector LiveCollector,
	cfg config.AutoBetLiveConfig,
	broadcaster Broadcaster,
	log logger.Logger,
) *LiveExecutionService {
	if cfg.CommandTimeout <= 0 {
		cfg.CommandTimeout = 5 * time.Second
	}
	if cfg.LeaseDuration <= 0 {
		cfg.LeaseDuration = 30 * time.Second
	}
	if cfg.MaxJun88Reprices <= 0 || cfg.MaxJun88Reprices > MaxJunRepriceRevisions {
		cfg.MaxJun88Reprices = MaxJunRepriceRevisions
	}
	return &LiveExecutionService{
		actions: actions, attempts: attempts, exposures: exposures, events: events,
		collector: collector, cfg: cfg, broadcaster: broadcaster, log: log,
		now:   func() time.Time { return time.Now().UTC() },
		owner: "live-execution-" + uuid.NewString(),
	}
}

func (s *LiveExecutionService) Trigger(item dto.SurebetView) {
	if s == nil || !s.runtimeEnabled() {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 8*s.cfg.CommandTimeout)
		defer cancel()
		if _, err := s.Execute(ctx, item); err != nil && s.log != nil {
			s.log.Warn("live auto-bet action failed", "opportunity_id", item.ID, "error", err.Error())
		}
	}()
}

func (s *LiveExecutionService) Execute(
	ctx context.Context,
	item dto.SurebetView,
) (dto.BetActionView, error) {
	if s == nil || !s.runtimeEnabled() {
		return dto.BetActionView{}, ErrLiveExecutionDisabled
	}
	if s.actions == nil || s.attempts == nil || s.exposures == nil ||
		s.events == nil || s.collector == nil {
		return dto.BetActionView{}, fmt.Errorf("%w: dependencies are unavailable", ErrInvalidLiveCandidate)
	}
	now := s.now().UTC()
	deadline, err := validatedSimulationDeadline(item, now)
	if err != nil {
		return dto.BetActionView{}, fmt.Errorf("%w: %v", ErrInvalidLiveCandidate, err)
	}
	if err := s.validateLiveConfig(ctx, now); err != nil {
		return dto.BetActionView{}, err
	}
	legs, sourceLegs, err := orderedLiveLegs(item)
	if err != nil {
		return dto.BetActionView{}, err
	}
	revision := liveConfirmationRevision(item)
	action := models.BetAction{
		BaseModel:      models.BaseModel{ID: uuid.NewString(), CreatedAt: now, UpdatedAt: now},
		IdempotencyKey: "live:" + s.cfg.AccountID + ":" + revision,
		OpportunityID:  item.ID, AccountID: s.cfg.AccountID, ConfirmationRevision: revision,
		Mode: "live", Status: StatusSelecting, Currency: "VND",
		TotalStakeVND: s.runtimeTotalStakeVND(), Version: 1,
	}
	if err := encodeLiveAction(&action, legs); err != nil {
		return dto.BetActionView{}, err
	}
	created, isNew, err := s.actions.Create(ctx, action)
	if err != nil {
		return dto.BetActionView{}, err
	}
	if !isNew {
		return toView(created)
	}
	action = created
	reserved, acquired, err := s.actions.TryReserveAccountStake(
		ctx, action.ID, action.AccountID, s.owner, action.Version,
		action.TotalStakeVND, now, now.Add(s.cfg.LeaseDuration),
	)
	if err != nil {
		return dto.BetActionView{}, err
	}
	if !acquired {
		return s.failAction(ctx, &action, legs, StatusAbortedNoExposure, "account_reservation_unavailable", ErrLiveRiskGate)
	}
	action = reserved
	if err := s.appendLiveEvent(ctx, action, "live_action_created", "", "account stake reserved"); err != nil {
		return dto.BetActionView{}, err
	}
	s.publishLiveAction(action)

	prepared, err := s.prepareBoth(ctx, action, sourceLegs, deadline)
	if err != nil {
		for index := range prepared {
			if prepared[index] != nil {
				s.cancelPrepared(context.WithoutCancel(ctx), action, *prepared[index])
			}
		}
		return s.failAction(ctx, &action, legs, StatusAbortedNoExposure, "prepare_failed", err)
	}
	if preparedBalancesCannotFund(action.TotalStakeVND, prepared[0], prepared[1], s.cfg.BalanceFloorVND) {
		for index := range prepared {
			if prepared[index] != nil {
				s.cancelPrepared(context.WithoutCancel(ctx), action, *prepared[index])
			}
		}
		s.disableForRisk("prepared bookmaker balance is below the minimum stake or balance floor")
		return s.failAction(ctx, &action, legs, StatusAbortedNoExposure, "balance_insufficient", ErrLiveRiskGate)
	}
	if absoluteDuration(prepared[0].response.ObservedAt.Sub(prepared[1].response.ObservedAt)) > livePreparedMaxSkew {
		for _, item := range prepared {
			s.cancelPrepared(context.WithoutCancel(ctx), action, *item)
		}
		return s.failAction(ctx, &action, legs, StatusAbortedNoExposure, "prepared_pair_skew", errors.New("prepared pair exceeded maximum observation skew"))
	}
	junStake, hedgeStake, _, ok := allocatePreparedPair(
		action.TotalStakeVND, prepared[0], prepared[1], s.cfg.BalanceFloorVND,
	)
	if !ok {
		for _, item := range prepared {
			s.cancelPrepared(context.WithoutCancel(ctx), action, *item)
		}
		if preparedBalancesCannotFund(action.TotalStakeVND, prepared[0], prepared[1], s.cfg.BalanceFloorVND) {
			s.disableForRisk("prepared bookmaker balances cannot fund the configured action stake")
			return s.failAction(ctx, &action, legs, StatusAbortedNoExposure, "balance_insufficient", ErrLiveRiskGate)
		}
		return s.failAction(ctx, &action, legs, StatusAbortedNoExposure, "prepared_pair_unprofitable", errors.New("prepared pair cannot produce positive rounded VND returns"))
	}
	prepared[0].view.StakeVND = junStake
	prepared[1].view.StakeVND = hedgeStake
	prepared[0].view.SelectedOdds = prepared[0].response.DisplayedOdds
	prepared[1].view.SelectedOdds = prepared[1].response.DisplayedOdds
	prepared[0].view.Status = "prepared"
	prepared[1].view.Status = "prepared"
	legs = []dto.BetActionLegView{prepared[0].view, prepared[1].view}
	if err := s.transitionAction(ctx, &action, legs, StatusReady, "both_betslips_prepared", "both live slips prepared and revalidated"); err != nil {
		return dto.BetActionView{}, err
	}

	if !s.cfg.CommitEnabled {
		for _, item := range prepared {
			s.cancelPrepared(context.WithoutCancel(ctx), action, *item)
		}
		if err := s.transitionAction(ctx, &action, legs, StatusDryRunCompleted, "dry_run_completed", "live commit switch is disabled"); err != nil {
			return dto.BetActionView{}, err
		}
		s.releaseActionReservation(ctx, &action)
		return toView(action)
	}

	return s.commitJunThenHedge(ctx, action, legs, prepared)
}

func (s *LiveExecutionService) validateLiveConfig(ctx context.Context, now time.Time) error {
	if strings.TrimSpace(s.cfg.AccountID) == "" || s.runtimeTotalStakeVND() <= 0 ||
		s.cfg.MaxOpenExposures <= 0 || s.cfg.BalanceFloorVND < 0 {
		return ErrLiveRiskGate
	}
	if !s.cfg.CommitEnabled {
		return nil
	}
	if s.cfg.MaxDailyTurnoverVND <= 0 || s.runtimeTotalStakeVND() > s.cfg.MaxDailyTurnoverVND {
		return ErrLiveRiskGate
	}
	openCount := 0
	for _, status := range []string{
		ExposureStatusOpen, ExposureStatusHedging,
		ExposureStatusSubmissionUnknown, ExposureStatusManualReview,
	} {
		open, err := s.exposures.List(ctx, status, s.cfg.MaxOpenExposures+1)
		if err != nil {
			return err
		}
		openCount += len(open)
	}
	if openCount >= s.cfg.MaxOpenExposures {
		return ErrLiveRiskGate
	}
	actions, err := s.actions.List(ctx, "", 10_000)
	if err != nil {
		return err
	}
	dayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	var turnover int64
	for _, action := range actions {
		if action.Mode == "live" && action.AccountID == s.cfg.AccountID && !action.CreatedAt.Before(dayStart) &&
			action.Status != StatusDryRunCompleted && action.Status != StatusAbortedNoExposure &&
			action.Status != StatusSelectionRejected {
			turnover += action.TotalStakeVND
		}
	}
	if turnover > s.cfg.MaxDailyTurnoverVND-s.runtimeTotalStakeVND() {
		return ErrLiveRiskGate
	}
	return nil
}

func (s *LiveExecutionService) prepareBoth(
	ctx context.Context,
	action models.BetAction,
	legs []dto.SurebetLegView,
	deadline time.Time,
) ([2]*preparedLiveLeg, error) {
	var prepared [2]*preparedLiveLeg
	type result struct {
		index int
		item  *preparedLiveLeg
		err   error
	}
	results := make(chan result, 2)
	for index := range legs {
		index := index
		go func() {
			item, err := s.prepareLeg(ctx, action, index, legs[index], 1, deadline)
			results <- result{index: index, item: item, err: err}
		}()
	}
	var firstErr error
	for range legs {
		result := <-results
		prepared[result.index] = result.item
		if firstErr == nil && result.err != nil {
			firstErr = result.err
		}
	}
	return prepared, firstErr
}

func (s *LiveExecutionService) prepareLeg(
	ctx context.Context,
	action models.BetAction,
	index int,
	leg dto.SurebetLegView,
	attemptNumber int,
	deadline time.Time,
) (*preparedLiveLeg, error) {
	now := s.now().UTC()
	attempt := models.BetAttempt{
		BaseModel:      models.BaseModel{ID: uuid.NewString(), CreatedAt: now, UpdatedAt: now},
		IdempotencyKey: fmt.Sprintf("%s:%s:prepare:%d", action.ID, leg.BookmakerID, attemptNumber),
		ActionID:       action.ID, AccountID: action.AccountID, AttemptNumber: attemptNumber,
		Phase: AttemptPhasePrepare, Status: AttemptStatusBeforeSend,
		LegID: liveLegIdentity(leg), BookmakerID: leg.BookmakerID, LobbyID: leg.LobbyID,
		CollectorID: liveSourceForLeg(leg).CollectorID,
		FixtureID:   leg.FixtureID, MarketID: leg.MarketID, OutcomeID: leg.OutcomeID,
		ProviderReference: leg.ProviderRef, QuoteRevision: action.ConfirmationRevision,
		OddsFormat: leg.OddsFormat, RawOdds: leg.RawOdds, ExpectedOdds: leg.Odds,
		Version: 1,
	}
	created, isNew, err := s.attempts.Create(ctx, attempt)
	if err != nil {
		return nil, err
	}
	if !isNew {
		return nil, fmt.Errorf("prepare attempt already exists with status %s", created.Status)
	}
	attempt = created
	expiresAt, err := s.liveCommandExpiry(deadline)
	if err != nil {
		return nil, err
	}
	command := dto.CollectorLiveBetRequest{
		Type: "prepare_bet", ActionID: action.ID, AttemptID: attempt.ID,
		OpportunityID: action.OpportunityID, LegID: attempt.LegID, AccountID: action.AccountID,
		ExpiresAt: expiresAt, TimeoutMS: int(s.cfg.CommandTimeout.Milliseconds()),
		FixtureID: leg.FixtureID, MarketID: leg.MarketID, OutcomeID: leg.OutcomeID,
		ProviderRef: leg.ProviderRef, ExpectedOdds: leg.Odds,
		ExpectedRawOdds: leg.RawOdds, OddsFormat: leg.OddsFormat,
		QuoteRevision: action.ConfirmationRevision,
	}
	response, _, err := s.executeAttempt(ctx, &attempt, liveSourceForLeg(leg), command, false)
	item := &preparedLiveLeg{
		index: index, leg: leg, attempt: attempt, response: response,
		view: dto.BetActionLegView{
			LegID: attempt.LegID, Sequence: index + 1, BookmakerID: leg.BookmakerID,
			LobbyID: leg.LobbyID, FixtureID: leg.FixtureID, MarketID: leg.MarketID,
			OutcomeID: leg.OutcomeID, OutcomeName: leg.OutcomeName,
			ProviderReference: leg.ProviderRef, ConfirmedOdds: leg.Odds, Status: "pending",
		},
	}
	if err != nil {
		return item, err
	}
	if err := s.validatePreparedResponse(action, attempt, leg, response); err != nil {
		return item, err
	}
	item.view.SelectedOdds = response.DisplayedOdds
	item.view.AvailableStake = float64(response.MaximumStakeVND)
	item.view.ObservedAt = response.ObservedAt.UTC()
	item.view.Status = "prepared"
	return item, nil
}

func (s *LiveExecutionService) executeAttempt(
	ctx context.Context,
	attempt *models.BetAttempt,
	source dto.CollectorSource,
	command dto.CollectorLiveBetRequest,
	deferAcceptedPersistence bool,
) (dto.CollectorLiveBetResponse, bool, error) {
	startedAt := s.now().UTC()
	if err := TransitionBetAttempt(attempt, AttemptStatusSubmitStarted, startedAt); err != nil {
		return dto.CollectorLiveBetResponse{}, false, err
	}
	updated, err := s.attempts.UpdateCAS(ctx, *attempt, attempt.Version)
	if err != nil {
		return dto.CollectorLiveBetResponse{}, false, err
	}
	*attempt = updated

	timeoutCtx, cancel := context.WithTimeout(ctx, s.cfg.CommandTimeout)
	defer cancel()
	response, sent, executeErr := s.collector.ExecuteLiveBet(timeoutCtx, source, command)
	if executeErr != nil {
		attempt.ErrorCode = "collector_command_failed"
		attempt.ErrorMessage = executeErr.Error()
		if sent && oneOf(command.Type, "commit_bet", "reconcile_bet") {
			attempt.Result = "submission_unknown"
			_ = TransitionBetAttempt(attempt, AttemptStatusAwaitingReconcile, s.now().UTC())
		} else {
			attempt.Result = "rejected"
			_ = TransitionBetAttempt(attempt, AttemptStatusResponseReceived, s.now().UTC())
		}
		if current, updateErr := s.attempts.UpdateCAS(context.WithoutCancel(ctx), *attempt, attempt.Version); updateErr == nil {
			*attempt = current
		}
		return response, sent, executeErr
	}
	if err := validateLiveCorrelation(actionCorrelation{
		actionID: attempt.ActionID, attemptID: attempt.ID, opportunityID: command.OpportunityID,
		legID: attempt.LegID, accountID: attempt.AccountID, source: source,
	}, response); err != nil {
		attempt.Result = "submission_unknown"
		attempt.ErrorCode = "invalid_collector_correlation"
		attempt.ErrorMessage = err.Error()
		if sent && oneOf(command.Type, "commit_bet", "reconcile_bet") {
			_ = TransitionBetAttempt(attempt, AttemptStatusAwaitingReconcile, s.now().UTC())
		} else {
			_ = TransitionBetAttempt(attempt, AttemptStatusResponseReceived, s.now().UTC())
		}
		if current, updateErr := s.attempts.UpdateCAS(context.WithoutCancel(ctx), *attempt, attempt.Version); updateErr == nil {
			*attempt = current
		}
		return response, sent, err
	}
	applyLiveResponseToAttempt(attempt, response)
	if command.Type == "commit_bet" && response.Result == "submission_unknown" {
		_ = TransitionBetAttempt(attempt, AttemptStatusAwaitingReconcile, s.now().UTC())
	} else {
		_ = TransitionBetAttempt(attempt, AttemptStatusResponseReceived, s.now().UTC())
	}
	if deferAcceptedPersistence && response.Result == "ticket_accepted" {
		return response, sent, nil
	}
	updated, err = s.attempts.UpdateCAS(context.WithoutCancel(ctx), *attempt, attempt.Version)
	if err != nil {
		return response, sent, err
	}
	*attempt = updated
	return response, sent, nil
}

type actionCorrelation struct {
	actionID, attemptID, opportunityID, legID, accountID string
	source                                               dto.CollectorSource
}

func validateLiveCorrelation(expected actionCorrelation, response dto.CollectorLiveBetResponse) error {
	if response.ProtocolVersion != liveProtocolVersion || response.SessionID == "" || response.RequestID == "" ||
		response.ActionID != expected.actionID || response.AttemptID != expected.attemptID ||
		response.OpportunityID != expected.opportunityID || response.LegID != expected.legID ||
		response.AccountID != expected.accountID || response.Source != expected.source {
		return errors.New("collector response correlation is invalid")
	}
	return nil
}

func applyLiveResponseToAttempt(attempt *models.BetAttempt, response dto.CollectorLiveBetResponse) {
	observedAt := response.ObservedAt.UTC()
	attempt.RequestID = response.RequestID
	attempt.SessionID = response.SessionID
	attempt.SessionGeneration = response.SessionGeneration
	attempt.Result = response.Result
	attempt.PrepareID = response.PrepareID
	attempt.SlipFingerprint = response.SlipFingerprint
	attempt.RawOdds = response.RawOdds
	attempt.OddsFormat = response.OddsFormat
	if response.DisplayedOdds != 0 {
		attempt.ExpectedOdds = response.DisplayedOdds
	}
	attempt.SubmittedOdds = response.SubmittedOdds
	attempt.OfferedOdds = response.OfferedOdds
	attempt.AcceptedOdds = response.AcceptedOdds
	attempt.MinimumStakeVND = response.MinimumStakeVND
	attempt.MaximumStakeVND = response.MaximumStakeVND
	attempt.StakeIncrementVND = response.StakeIncrementVND
	attempt.BalanceVND = response.BalanceVND
	attempt.TicketID = response.TicketID
	attempt.AcceptedStakeVND = response.StakeVND
	attempt.ObservedAt = &observedAt
	attempt.ErrorMessage = response.Error
}

func (s *LiveExecutionService) validatePreparedResponse(
	action models.BetAction,
	attempt models.BetAttempt,
	leg dto.SurebetLegView,
	response dto.CollectorLiveBetResponse,
) error {
	if response.Type != "bet_prepared" || response.Result != "prepared" ||
		response.PrepareID == "" || response.SlipFingerprint == "" ||
		response.SessionGeneration == "" || !finiteMalayOdds(response.DisplayedOdds) ||
		response.MinimumStakeVND <= 0 || response.MaximumStakeVND < response.MinimumStakeVND ||
		response.StakeIncrementVND <= 0 || response.BalanceVND < response.MinimumStakeVND ||
		response.ObservedAt.IsZero() {
		return errors.New("collector prepared response is incomplete")
	}
	age := s.now().UTC().Sub(response.ObservedAt.UTC())
	if age < -liveClockTolerance || age > livePreparedMaxAge {
		return errors.New("collector prepared response is stale")
	}
	if leg.BookmakerID == "jun88" {
		if response.OddsFormat != "malay" ||
			math.Abs(response.RawOdds-response.DisplayedOdds) > liveOddsTolerance {
			return errors.New("Jun88 prepared odds provenance is invalid")
		}
	} else if leg.BookmakerID == "8xbet" {
		if response.OddsFormat != "indonesian" || response.RawOdds <= 0 {
			return errors.New("8xbet prepared odds provenance is invalid")
		}
		expected := response.RawOdds
		if expected > 1 {
			expected = -1 / expected
		}
		expected = math.Round(expected*100) / 100
		if math.Abs(expected-response.DisplayedOdds) > liveOddsTolerance {
			return errors.New("8xbet prepared odds conversion is invalid")
		}
	} else {
		return errors.New("unsupported live bookmaker")
	}
	if attempt.ActionID != action.ID || attempt.LegID != liveLegIdentity(leg) ||
		attempt.ProviderReference != leg.ProviderRef {
		return errors.New("prepared selection identity changed")
	}
	return nil
}

func (s *LiveExecutionService) commitJunThenHedge(
	ctx context.Context,
	action models.BetAction,
	legs []dto.BetActionLegView,
	prepared [2]*preparedLiveLeg,
) (dto.BetActionView, error) {
	jun := prepared[0]
	eight := prepared[1]
	for revision := 0; ; revision++ {
		if err := s.transitionAction(ctx, &action, legs, StatusPlacingJun88, "jun88_commit_started", "submitting Jun88 first"); err != nil {
			return dto.BetActionView{}, err
		}
		if acquired, reserveErr := s.renewActionReservation(ctx, &action); reserveErr != nil || !acquired {
			if reserveErr == nil {
				reserveErr = ErrLiveRiskGate
			}
			return s.failAction(ctx, &action, legs, StatusAbortedNoExposure, "account_reservation_lost", reserveErr)
		}
		attempt, err := s.newCommitAttempt(ctx, action, *jun, revision+1, "")
		if err != nil {
			return dto.BetActionView{}, err
		}
		// The freshly observed prepared slip supersedes the short passive
		// confirmation window. Its own observation time and command TTL gate the
		// commit, so Playwright preparation latency does not consume ValidUntil.
		expiresAt := s.now().UTC().Add(s.cfg.CommandTimeout)
		command := dto.CollectorLiveBetRequest{
			Type: "commit_bet", ActionID: action.ID, AttemptID: attempt.ID,
			OpportunityID: action.OpportunityID, LegID: attempt.LegID, AccountID: action.AccountID,
			ExpiresAt: expiresAt, TimeoutMS: int(s.cfg.CommandTimeout.Milliseconds()),
			PrepareID: jun.response.PrepareID, ExpectedOdds: jun.response.DisplayedOdds,
			StakeVND: jun.view.StakeVND, IdempotencyKey: attempt.IdempotencyKey,
		}
		response, _, executeErr := s.executeAttempt(ctx, &attempt, liveSourceForLeg(jun.leg), command, true)
		if executeErr != nil || attempt.Status == AttemptStatusAwaitingReconcile {
			legs[0].Status = "submission_unknown"
			legs[0].Error = errorMessage(executeErr, response.Error)
			return s.markActionUnknown(ctx, &action, legs, "jun88_submission_unknown", errors.New(legs[0].Error))
		}
		switch response.Result {
		case "ticket_accepted":
			if err := validateAcceptedTicket(attempt, response, jun.response.DisplayedOdds, jun.view.StakeVND, s.now()); err != nil {
				attempt.Status = AttemptStatusAwaitingReconcile
				attempt.Result = "submission_unknown"
				attempt.ErrorCode = "invalid_ticket_response"
				attempt.ErrorMessage = err.Error()
				if updated, updateErr := s.attempts.UpdateCAS(context.WithoutCancel(ctx), attempt, attempt.Version); updateErr == nil {
					attempt = updated
				}
				return s.markActionUnknown(ctx, &action, legs, "jun88_ticket_invalid", err)
			}
			return s.openExposureAndHedge(ctx, action, legs, attempt, response, *jun, *eight)
		case "odds_changed":
			if err := validateOddsChanged(response, jun.response.DisplayedOdds, s.now()); err != nil {
				return s.markActionUnknown(ctx, &action, legs, "jun88_odds_change_invalid", err)
			}
			if revision >= s.cfg.MaxJun88Reprices || action.RepriceRevision >= MaxJunRepriceRevisions {
				s.cancelPrepared(context.WithoutCancel(ctx), action, *jun)
				s.cancelPrepared(context.WithoutCancel(ctx), action, *eight)
				return s.failAction(ctx, &action, legs, StatusAbortedNoExposure, "jun88_reprice_limit", ErrJunRepriceLimitReached)
			}
			if err := s.transitionAction(ctx, &action, legs, StatusAwaitingOddsConfirmation, "jun88_odds_changed", "Jun88 returned an explicit new price"); err != nil {
				return dto.BetActionView{}, err
			}
			if _, err := AdvanceJunRepriceRevision(&action); err != nil {
				return s.failAction(ctx, &action, legs, StatusAbortedNoExposure, "jun88_reprice_limit", err)
			}
			jun.response.DisplayedOdds = response.OfferedOdds
			jun.response.RawOdds = response.OfferedOdds
			jun.view.SelectedOdds = response.OfferedOdds
			junStake, hedgeStake, _, profitable := allocatePreparedPair(
				action.TotalStakeVND, jun, eight, s.cfg.BalanceFloorVND,
			)
			if !profitable {
				s.cancelPrepared(context.WithoutCancel(ctx), action, *jun)
				s.cancelPrepared(context.WithoutCancel(ctx), action, *eight)
				return s.failAction(ctx, &action, legs, StatusAbortedNoExposure, "jun88_reprice_unprofitable", ErrNoProfitableHedge)
			}
			jun.view.StakeVND = junStake
			eight.view.StakeVND = hedgeStake
			legs[0] = jun.view
			legs[1] = eight.view
			if err := s.transitionAction(ctx, &action, legs, StatusReady, "jun88_reprice_approved", "repriced pair remains profitable"); err != nil {
				return dto.BetActionView{}, err
			}
			continue
		case "rejected":
			s.cancelPrepared(context.WithoutCancel(ctx), action, *jun)
			s.cancelPrepared(context.WithoutCancel(ctx), action, *eight)
			return s.failAction(ctx, &action, legs, StatusAbortedNoExposure, "jun88_submission_rejected", errors.New(errorMessage(nil, response.Error)))
		default:
			return s.markActionUnknown(ctx, &action, legs, "jun88_submission_unknown", errors.New("Jun88 returned an unknown commit result"))
		}
	}
}

func (s *LiveExecutionService) openExposureAndHedge(
	ctx context.Context,
	action models.BetAction,
	legs []dto.BetActionLegView,
	junAttempt models.BetAttempt,
	junResponse dto.CollectorLiveBetResponse,
	jun preparedLiveLeg,
	eight preparedLiveLeg,
) (dto.BetActionView, error) {
	now := s.now().UTC()
	exposureID := uuid.NewString()
	exposure := models.BetExposure{
		BaseModel:      models.BaseModel{ID: exposureID, CreatedAt: now, UpdatedAt: now},
		IdempotencyKey: "exposure:" + action.ID + ":" + junResponse.TicketID,
		ActionID:       action.ID, AccountID: action.AccountID, Status: ExposureStatusOpen,
		Currency: "VND", Version: 1,
		Jun88AttemptID: junAttempt.ID, Jun88TicketID: junResponse.TicketID,
		Jun88LegID: junAttempt.LegID, Jun88FixtureID: jun.leg.FixtureID,
		Jun88MarketID: jun.leg.MarketID, Jun88OutcomeID: jun.leg.OutcomeID,
		Jun88ProviderReference: jun.leg.ProviderRef,
		Jun88AcceptedOdds:      junResponse.AcceptedOdds, Jun88StakeVND: junResponse.StakeVND,
		Jun88AcceptedAt:  junResponse.ObservedAt.UTC(),
		HedgeBookmakerID: "8xbet", HedgeLegID: eight.attempt.LegID,
		HedgeFixtureID: eight.leg.FixtureID, HedgeMarketID: eight.leg.MarketID,
		HedgeOutcomeID: eight.leg.OutcomeID, HedgeProviderReference: eight.leg.ProviderRef,
		MaximumTotalStakeVND:   action.TotalStakeVND,
		HedgeMinimumStakeVND:   eight.response.MinimumStakeVND,
		HedgeMaximumStakeVND:   eight.response.MaximumStakeVND,
		HedgeStakeIncrementVND: eight.response.StakeIncrementVND,
		OpenedAt:               now,
	}
	if err := ValidateOpenExposure(exposure); err != nil {
		return s.markActionUnknown(ctx, &action, legs, "exposure_invalid", err)
	}
	legs[0].Status = "ticket_received"
	legs[0].TicketID = junResponse.TicketID
	legs[0].AcceptedOdds = junResponse.AcceptedOdds
	legs[0].StakeVND = junResponse.StakeVND
	action.Status = StatusJun88TicketReceived
	action.ExposureOpen = true
	action.ExposureID = exposure.ID
	action.CompletedAt = nil
	if err := encodeLiveAction(&action, legs); err != nil {
		return dto.BetActionView{}, err
	}
	junAttempt.ExposureID = exposure.ID
	junAttempt.Status = AttemptStatusResponseReceived
	junAttempt.Result = "ticket_accepted"
	event := newJournalEvent(action, exposure.ID, "jun88_ticket_received", "jun88", junResponse.TicketID, now)
	committed, _, err := s.exposures.CommitJun88Ticket(
		context.WithoutCancel(ctx), action, action.Version,
		junAttempt, junAttempt.Version, exposure, event,
	)
	if err != nil {
		return dto.BetActionView{}, err
	}
	exposure = committed
	action.Version++
	action.UpdatedAt = now
	s.publishLiveAction(action)
	s.publishExposure(exposure)

	postCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 4*s.cfg.CommandTimeout)
	defer cancel()
	return s.commitEightXBet(postCtx, action, legs, exposure, eight, 1)
}

func (s *LiveExecutionService) commitEightXBet(
	ctx context.Context,
	action models.BetAction,
	legs []dto.BetActionLegView,
	exposure models.BetExposure,
	eight preparedLiveLeg,
	commitStart int,
) (dto.BetActionView, error) {
	for revision := 0; revision <= MaxJunRepriceRevisions; revision++ {
		attemptNumber := commitStart + revision
		quoteRevision := liveHedgeQuoteRevision(eight.response, attemptNumber)
		plan, evaluateErr := EvaluateExposureHedge(&exposure, HedgeQuote{
			BookmakerID: "8xbet", FixtureID: exposure.HedgeFixtureID,
			MarketID: exposure.HedgeMarketID, OutcomeID: exposure.HedgeOutcomeID,
			ProviderReference: exposure.HedgeProviderReference, Revision: quoteRevision,
			MalayOdds: eight.response.DisplayedOdds, ObservedAt: eight.response.ObservedAt,
			AvailableBalanceVND: spendableBalance(eight.response.BalanceVND, s.cfg.BalanceFloorVND),
		})
		updated, err := s.exposures.UpdateCAS(context.WithoutCancel(ctx), exposure, exposure.Version)
		if err != nil {
			return dto.BetActionView{}, err
		}
		exposure = updated
		s.publishExposure(exposure)
		if evaluateErr != nil {
			eight.view.Status = "waiting_profitable_hedge"
			legs[1] = eight.view
			s.cancelPrepared(context.WithoutCancel(ctx), action, eight)
			return s.openExposure(ctx, &action, legs, &exposure, "eightxbet_price_unprofitable", evaluateErr)
		}
		eight.view.StakeVND = plan.StakeVND
		legs[1] = eight.view
		if err := TransitionBetExposure(&exposure, ExposureStatusHedging, s.now()); err != nil {
			return dto.BetActionView{}, err
		}
		updated, err = s.exposures.UpdateCAS(context.WithoutCancel(ctx), exposure, exposure.Version)
		if err != nil {
			return dto.BetActionView{}, err
		}
		exposure = updated
		if err := s.transitionAction(ctx, &action, legs, StatusPlacingEightXBet, "eightxbet_commit_started", "submitting profitable hedge"); err != nil {
			return dto.BetActionView{}, err
		}
		if acquired, reserveErr := s.renewActionReservation(ctx, &action); reserveErr != nil || !acquired {
			if exposure.Status == ExposureStatusHedging {
				_ = TransitionBetExposure(&exposure, ExposureStatusOpen, s.now())
				if updatedExposure, updateErr := s.exposures.UpdateCAS(context.WithoutCancel(ctx), exposure, exposure.Version); updateErr == nil {
					exposure = updatedExposure
				}
			}
			if reserveErr == nil {
				reserveErr = ErrLiveRiskGate
			}
			return s.openExposure(ctx, &action, legs, &exposure, "account_reservation_lost", reserveErr)
		}
		attempt, err := s.newCommitAttempt(ctx, action, eight, attemptNumber, exposure.ID)
		if err != nil {
			return dto.BetActionView{}, err
		}
		command := dto.CollectorLiveBetRequest{
			Type: "commit_bet", ActionID: action.ID, AttemptID: attempt.ID,
			OpportunityID: action.OpportunityID, LegID: attempt.LegID, AccountID: action.AccountID,
			ExpiresAt: s.now().Add(s.cfg.CommandTimeout), TimeoutMS: int(s.cfg.CommandTimeout.Milliseconds()),
			PrepareID: eight.response.PrepareID, ExpectedOdds: eight.response.DisplayedOdds,
			StakeVND: plan.StakeVND, IdempotencyKey: attempt.IdempotencyKey,
		}
		response, _, executeErr := s.executeAttempt(ctx, &attempt, liveSourceForLeg(eight.leg), command, false)
		if executeErr != nil || attempt.Status == AttemptStatusAwaitingReconcile || response.Result == "submission_unknown" {
			return s.markHedgeUnknown(ctx, &action, legs, &exposure, attempt, executeErr)
		}
		switch response.Result {
		case "ticket_accepted":
			if err := validateAcceptedTicket(attempt, response, eight.response.DisplayedOdds, plan.StakeVND, s.now()); err != nil {
				return s.markHedgeUnknown(ctx, &action, legs, &exposure, attempt, err)
			}
			exposure.HedgeAttemptID = attempt.ID
			exposure.HedgeTicketID = response.TicketID
			exposure.HedgeAcceptedOdds = response.AcceptedOdds
			exposure.HedgeAcceptedStakeVND = response.StakeVND
			acceptedAt := response.ObservedAt.UTC()
			exposure.HedgeAcceptedAt = &acceptedAt
			if !acceptedTicketsProfitable(exposure) {
				return s.markHedgeUnknown(ctx, &action, legs, &exposure, attempt, errors.New("accepted ticket terms are not profitable"))
			}
			if err := TransitionBetExposure(&exposure, ExposureStatusCompleted, s.now()); err != nil {
				return dto.BetActionView{}, err
			}
			updated, err := s.exposures.UpdateCAS(context.WithoutCancel(ctx), exposure, exposure.Version)
			if err != nil {
				return dto.BetActionView{}, err
			}
			exposure = updated
			legs[1].Status = "ticket_received"
			legs[1].TicketID = response.TicketID
			legs[1].AcceptedOdds = response.AcceptedOdds
			legs[1].StakeVND = response.StakeVND
			if err := s.transitionAction(ctx, &action, legs, StatusCompleted, "live_action_completed", "both bookmaker tickets received"); err != nil {
				return dto.BetActionView{}, err
			}
			s.publishExposure(exposure)
			s.releaseActionReservation(ctx, &action)
			return toView(action)
		case "odds_changed":
			if err := validateOddsChanged(response, eight.response.DisplayedOdds, s.now()); err != nil {
				return s.markHedgeUnknown(ctx, &action, legs, &exposure, attempt, err)
			}
			if err := TransitionBetExposure(&exposure, ExposureStatusOpen, s.now()); err != nil {
				return dto.BetActionView{}, err
			}
			updated, err := s.exposures.UpdateCAS(context.WithoutCancel(ctx), exposure, exposure.Version)
			if err != nil {
				return dto.BetActionView{}, err
			}
			exposure = updated
			if err := s.transitionAction(ctx, &action, legs, StatusExposureOpen, "eightxbet_odds_changed", "8xbet returned an explicit new price"); err != nil {
				return dto.BetActionView{}, err
			}
			eight.response.DisplayedOdds = response.OfferedOdds
			eight.response.RawOdds = offeredRawOdds(response.OfferedOdds)
			eight.response.ObservedAt = response.ObservedAt
			continue
		case "rejected":
			if err := TransitionBetExposure(&exposure, ExposureStatusOpen, s.now()); err != nil {
				return dto.BetActionView{}, err
			}
			exposure.LastFailureCode = "eightxbet_submission_rejected"
			exposure.LastFailureMessage = response.Error
			updated, err := s.exposures.UpdateCAS(context.WithoutCancel(ctx), exposure, exposure.Version)
			if err != nil {
				return dto.BetActionView{}, err
			}
			exposure = updated
			return s.openExposure(ctx, &action, legs, &exposure, exposure.LastFailureCode, errors.New(errorMessage(nil, response.Error)))
		default:
			return s.markHedgeUnknown(ctx, &action, legs, &exposure, attempt, errors.New("8xbet returned an unknown commit result"))
		}
	}
	return s.openExposure(ctx, &action, legs, &exposure, "eightxbet_reprice_limit", ErrNoProfitableHedge)
}

func (s *LiveExecutionService) newCommitAttempt(
	ctx context.Context,
	action models.BetAction,
	prepared preparedLiveLeg,
	number int,
	exposureID string,
) (models.BetAttempt, error) {
	now := s.now().UTC()
	attempt := models.BetAttempt{
		BaseModel:      models.BaseModel{ID: uuid.NewString(), CreatedAt: now, UpdatedAt: now},
		IdempotencyKey: fmt.Sprintf("%s:%s:commit:%d", action.ID, prepared.leg.BookmakerID, number),
		ActionID:       action.ID, ExposureID: exposureID, AccountID: action.AccountID,
		AttemptNumber: number, Phase: AttemptPhaseCommit, Status: AttemptStatusBeforeSend,
		LegID: prepared.attempt.LegID, BookmakerID: prepared.leg.BookmakerID,
		LobbyID: prepared.leg.LobbyID, CollectorID: liveSourceForLeg(prepared.leg).CollectorID,
		FixtureID: prepared.leg.FixtureID, MarketID: prepared.leg.MarketID,
		OutcomeID: prepared.leg.OutcomeID, ProviderReference: prepared.leg.ProviderRef,
		PrepareID: prepared.response.PrepareID, SlipFingerprint: prepared.response.SlipFingerprint,
		QuoteRevision: liveHedgeQuoteRevision(prepared.response, number),
		OddsFormat:    prepared.response.OddsFormat, RawOdds: prepared.response.RawOdds,
		ExpectedOdds: prepared.response.DisplayedOdds, RequestedStakeVND: prepared.view.StakeVND,
		MinimumStakeVND:   prepared.response.MinimumStakeVND,
		MaximumStakeVND:   prepared.response.MaximumStakeVND,
		StakeIncrementVND: prepared.response.StakeIncrementVND,
		BalanceVND:        prepared.response.BalanceVND, Version: 1,
	}
	created, isNew, err := s.attempts.Create(ctx, attempt)
	if err != nil {
		return models.BetAttempt{}, err
	}
	if !isNew {
		return models.BetAttempt{}, fmt.Errorf("commit attempt already exists with status %s", created.Status)
	}
	return created, nil
}

func (s *LiveExecutionService) cancelPrepared(
	ctx context.Context,
	action models.BetAction,
	prepared preparedLiveLeg,
) {
	attempts, err := s.attempts.ListByAction(ctx, action.ID, liveAttemptQueryLimit)
	if err != nil {
		return
	}
	number := 1
	for _, attempt := range attempts {
		if attempt.BookmakerID == prepared.leg.BookmakerID && attempt.Phase == AttemptPhaseCancel &&
			attempt.AttemptNumber >= number {
			number = attempt.AttemptNumber + 1
		}
	}
	now := s.now().UTC()
	attempt := models.BetAttempt{
		BaseModel:      models.BaseModel{ID: uuid.NewString(), CreatedAt: now, UpdatedAt: now},
		IdempotencyKey: fmt.Sprintf("%s:%s:cancel:%s", action.ID, prepared.leg.BookmakerID, prepared.response.PrepareID),
		ActionID:       action.ID, AccountID: action.AccountID, AttemptNumber: number,
		Phase: AttemptPhaseCancel, Status: AttemptStatusBeforeSend,
		LegID: prepared.attempt.LegID, BookmakerID: prepared.leg.BookmakerID,
		LobbyID: prepared.leg.LobbyID, CollectorID: liveSourceForLeg(prepared.leg).CollectorID,
		FixtureID: prepared.leg.FixtureID, MarketID: prepared.leg.MarketID,
		OutcomeID: prepared.leg.OutcomeID, ProviderReference: prepared.leg.ProviderRef,
		PrepareID: prepared.response.PrepareID, Version: 1,
	}
	created, isNew, err := s.attempts.Create(ctx, attempt)
	if err != nil || !isNew {
		return
	}
	attempt = created
	_, _, _ = s.executeAttempt(ctx, &attempt, liveSourceForLeg(prepared.leg), dto.CollectorLiveBetRequest{
		Type: "cancel_prepared_bet", ActionID: action.ID, AttemptID: attempt.ID,
		OpportunityID: action.OpportunityID, LegID: attempt.LegID, AccountID: action.AccountID,
		PrepareID: prepared.response.PrepareID, ExpiresAt: now.Add(s.cfg.CommandTimeout),
		TimeoutMS: int(s.cfg.CommandTimeout.Milliseconds()),
	}, false)
}

func (s *LiveExecutionService) transitionAction(
	ctx context.Context,
	action *models.BetAction,
	legs []dto.BetActionLegView,
	status, eventType, message string,
) error {
	if err := TransitionBetAction(action, status, s.now().UTC()); err != nil {
		return err
	}
	if err := encodeLiveAction(action, legs); err != nil {
		return err
	}
	updated, err := s.actions.UpdateCAS(context.WithoutCancel(ctx), *action, action.Version)
	if err != nil {
		return err
	}
	*action = updated
	if err := s.appendLiveEvent(context.WithoutCancel(ctx), *action, eventType, "", message); err != nil {
		return err
	}
	s.publishLiveAction(*action)
	return nil
}

func (s *LiveExecutionService) failAction(
	ctx context.Context,
	action *models.BetAction,
	legs []dto.BetActionLegView,
	status, code string,
	cause error,
) (dto.BetActionView, error) {
	action.ErrorCode = code
	action.ErrorMessage = errorMessage(cause, "")
	if transitionErr := s.transitionAction(ctx, action, legs, status, code, action.ErrorMessage); transitionErr != nil {
		return dto.BetActionView{}, transitionErr
	}
	s.releaseActionReservation(ctx, action)
	return toView(*action)
}

func (s *LiveExecutionService) markActionUnknown(
	ctx context.Context,
	action *models.BetAction,
	legs []dto.BetActionLegView,
	code string,
	cause error,
) (dto.BetActionView, error) {
	action.ErrorCode = code
	action.ErrorMessage = errorMessage(cause, "")
	if err := s.transitionAction(ctx, action, legs, StatusSubmissionUnknown, code, action.ErrorMessage); err != nil {
		return dto.BetActionView{}, err
	}
	return toView(*action)
}

func (s *LiveExecutionService) openExposure(
	ctx context.Context,
	action *models.BetAction,
	legs []dto.BetActionLegView,
	exposure *models.BetExposure,
	code string,
	cause error,
) (dto.BetActionView, error) {
	exposure.LastFailureCode = code
	exposure.LastFailureMessage = errorMessage(cause, "")
	exposure.UpdatedAt = s.now().UTC()
	updated, err := s.exposures.UpdateCAS(context.WithoutCancel(ctx), *exposure, exposure.Version)
	if err != nil {
		return dto.BetActionView{}, err
	}
	*exposure = updated
	action.ErrorCode = code
	action.ErrorMessage = exposure.LastFailureMessage
	if action.Status != StatusExposureOpen {
		if err := s.transitionAction(ctx, action, legs, StatusExposureOpen, "exposure_open", exposure.LastFailureMessage); err != nil {
			return dto.BetActionView{}, err
		}
	} else {
		if err := encodeLiveAction(action, legs); err != nil {
			return dto.BetActionView{}, err
		}
		updatedAction, err := s.actions.UpdateCAS(context.WithoutCancel(ctx), *action, action.Version)
		if err != nil {
			return dto.BetActionView{}, err
		}
		*action = updatedAction
		if err := s.appendLiveEvent(context.WithoutCancel(ctx), *action, "exposure_still_open", "8xbet", exposure.LastFailureMessage); err != nil {
			return dto.BetActionView{}, err
		}
		s.publishLiveAction(*action)
	}
	s.publishExposure(*exposure)
	return toView(*action)
}

func (s *LiveExecutionService) markHedgeUnknown(
	ctx context.Context,
	action *models.BetAction,
	legs []dto.BetActionLegView,
	exposure *models.BetExposure,
	attempt models.BetAttempt,
	cause error,
) (dto.BetActionView, error) {
	if attempt.Status != AttemptStatusAwaitingReconcile {
		attempt.Status = AttemptStatusAwaitingReconcile
		attempt.Result = "submission_unknown"
		attempt.ErrorCode = "eightxbet_submission_unknown"
		attempt.ErrorMessage = errorMessage(cause, attempt.ErrorMessage)
		updatedAttempt, err := s.attempts.UpdateCAS(context.WithoutCancel(ctx), attempt, attempt.Version)
		if err != nil {
			return dto.BetActionView{}, err
		}
		attempt = updatedAttempt
	}
	if exposure.Status == ExposureStatusHedging {
		if err := TransitionBetExposure(exposure, ExposureStatusSubmissionUnknown, s.now()); err != nil {
			return dto.BetActionView{}, err
		}
	}
	exposure.HedgeAttemptID = attempt.ID
	exposure.LastFailureCode = "eightxbet_submission_unknown"
	exposure.LastFailureMessage = errorMessage(cause, attempt.ErrorMessage)
	updated, err := s.exposures.UpdateCAS(context.WithoutCancel(ctx), *exposure, exposure.Version)
	if err != nil {
		return dto.BetActionView{}, err
	}
	*exposure = updated
	action.ErrorCode = exposure.LastFailureCode
	action.ErrorMessage = exposure.LastFailureMessage
	if err := s.transitionAction(ctx, action, legs, StatusSubmissionUnknown, exposure.LastFailureCode, exposure.LastFailureMessage); err != nil {
		return dto.BetActionView{}, err
	}
	s.publishExposure(*exposure)
	return toView(*action)
}

func (s *LiveExecutionService) releaseActionReservation(ctx context.Context, action *models.BetAction) {
	if action == nil || action.ReservedStakeVND <= 0 || action.LeaseOwner != s.owner {
		return
	}
	updated, err := s.actions.ReleaseAccountStake(
		context.WithoutCancel(ctx), action.ID, action.AccountID, s.owner, action.Version, s.now(),
	)
	if err == nil {
		*action = updated
	}
}

func (s *LiveExecutionService) renewActionReservation(
	ctx context.Context,
	action *models.BetAction,
) (bool, error) {
	if action == nil {
		return false, ErrLiveRiskGate
	}
	now := s.now().UTC()
	updated, acquired, err := s.actions.TryReserveAccountStake(
		context.WithoutCancel(ctx), action.ID, action.AccountID, s.owner,
		action.Version, action.TotalStakeVND, now, now.Add(s.cfg.LeaseDuration),
	)
	if err == nil && acquired {
		*action = updated
	}
	return acquired, err
}

func (s *LiveExecutionService) appendLiveEvent(
	ctx context.Context,
	action models.BetAction,
	eventType, bookmakerID, message string,
) error {
	_, _, err := s.events.Append(ctx, newJournalEvent(
		action, action.ExposureID, eventType, bookmakerID, message, s.now().UTC(),
	))
	return err
}

func newJournalEvent(
	action models.BetAction,
	exposureID, eventType, bookmakerID, message string,
	at time.Time,
) models.BetActionEvent {
	return models.BetActionEvent{
		BaseModel:      models.BaseModel{ID: uuid.NewString(), CreatedAt: at, UpdatedAt: at},
		IdempotencyKey: fmt.Sprintf("%s:event:%s:%d", action.ID, eventType, action.Version),
		ActionID:       action.ID, ExposureID: exposureID, Type: eventType, Status: action.Status,
		BookmakerID: bookmakerID, Message: message, Metadata: []byte("{}"), OccurredAt: at,
	}
}

func (s *LiveExecutionService) publishLiveAction(action models.BetAction) {
	if s.broadcaster == nil {
		return
	}
	view, err := toView(action)
	if err != nil {
		return
	}
	s.broadcaster.Broadcast(realtime.Event{
		Type: "auto_bet_live_updated", SentAt: s.now().UTC(), Payload: view,
	})
}

func (s *LiveExecutionService) publishExposure(exposure models.BetExposure) {
	if s.broadcaster == nil {
		return
	}
	s.broadcaster.Broadcast(realtime.Event{
		Type: "bet_exposure_updated", SentAt: s.now().UTC(), Payload: ToBetExposureView(exposure),
	})
}

func orderedLiveLegs(item dto.SurebetView) ([]dto.BetActionLegView, []dto.SurebetLegView, error) {
	if item.ID == "" || len(item.Legs) != 2 || item.MatchAmbiguous {
		return nil, nil, fmt.Errorf("%w: opportunity must have two unambiguous legs", ErrInvalidLiveCandidate)
	}
	views := make([]dto.BetActionLegView, 2)
	legs := make([]dto.SurebetLegView, 2)
	found := [2]bool{}
	for _, leg := range item.Legs {
		index := -1
		switch {
		case leg.BookmakerID == "jun88" && leg.LobbyID == "cmd":
			index = 0
		case leg.BookmakerID == "8xbet" && leg.LobbyID == "default":
			index = 1
		}
		if index < 0 || found[index] || leg.FixtureID == "" || leg.MarketID == "" ||
			leg.OutcomeID == "" || leg.ProviderRef == "" || leg.SourceEventID == "" ||
			!finiteMalayOdds(leg.Odds) || leg.RawOdds == 0 {
			return nil, nil, fmt.Errorf("%w: live leg identity or provenance is incomplete", ErrInvalidLiveCandidate)
		}
		if (index == 0 && leg.OddsFormat != "malay") ||
			(index == 1 && leg.OddsFormat != "indonesian") {
			return nil, nil, fmt.Errorf("%w: live leg odds format is invalid", ErrInvalidLiveCandidate)
		}
		found[index] = true
		legs[index] = leg
		views[index] = dto.BetActionLegView{
			LegID: liveLegIdentity(leg), Sequence: index + 1, BookmakerID: leg.BookmakerID,
			LobbyID: leg.LobbyID, FixtureID: leg.FixtureID, MarketID: leg.MarketID,
			OutcomeID: leg.OutcomeID, OutcomeName: leg.OutcomeName,
			ProviderReference: leg.ProviderRef, ConfirmedOdds: leg.Odds, Status: "pending",
		}
	}
	if !found[0] || !found[1] || legs[0].Odds >= 0 || legs[1].Odds >= 0 {
		return nil, nil, fmt.Errorf("%w: opening pair must contain two negative Malay odds", ErrInvalidLiveCandidate)
	}
	return views, legs, nil
}

func allocatePreparedPair(
	totalStakeVND int64,
	jun, eight *preparedLiveLeg,
	balanceFloorVND int64,
) (int64, int64, int64, bool) {
	if jun == nil || eight == nil || totalStakeVND <= 0 ||
		jun.response.DisplayedOdds >= 0 || eight.response.DisplayedOdds >= 0 {
		return 0, 0, 0, false
	}
	junDecimal, junOK := malayDecimalOdds(jun.response.DisplayedOdds)
	eightDecimal, eightOK := malayDecimalOdds(eight.response.DisplayedOdds)
	if !junOK || !eightOK {
		return 0, 0, 0, false
	}
	junMin := alignUp(jun.response.MinimumStakeVND, jun.response.StakeIncrementVND)
	eightMin := alignUp(eight.response.MinimumStakeVND, eight.response.StakeIncrementVND)
	junMax := alignDown(minPositiveInt64(
		jun.response.MaximumStakeVND,
		spendableBalance(jun.response.BalanceVND, balanceFloorVND),
		totalStakeVND-eightMin,
	), jun.response.StakeIncrementVND)
	eightMax := alignDown(minPositiveInt64(
		eight.response.MaximumStakeVND,
		spendableBalance(eight.response.BalanceVND, balanceFloorVND),
		totalStakeVND-junMin,
	), eight.response.StakeIncrementVND)
	if junMin <= 0 || eightMin <= 0 || junMax < junMin || eightMax < eightMin {
		return 0, 0, 0, false
	}
	combined := (1 / junDecimal) + (1 / eightDecimal)
	if combined >= 1 {
		return 0, 0, 0, false
	}
	idealJun := float64(totalStakeVND) * (1 / junDecimal) / combined
	idealEight := float64(totalStakeVND) * (1 / eightDecimal) / combined
	junCandidates := stakeCandidates(idealJun, junMin, junMax, jun.response.StakeIncrementVND)
	eightCandidates := stakeCandidates(idealEight, eightMin, eightMax, eight.response.StakeIncrementVND)
	bestJun, bestEight, bestProfit := int64(0), int64(0), int64(math.MinInt64)
	bestTotal := int64(0)
	for _, junStake := range junCandidates {
		remainingMax := totalStakeVND - junStake
		if remainingMax < eightMin {
			continue
		}
		localEight := append([]int64(nil), eightCandidates...)
		localEight = append(localEight, alignDown(minPositiveInt64(eightMax, remainingMax), eight.response.StakeIncrementVND))
		for _, eightStake := range uniquePositiveInt64(localEight) {
			if eightStake < eightMin || eightStake > eightMax || junStake+eightStake > totalStakeVND {
				continue
			}
			total := junStake + eightStake
			junProfit := int64(math.Round(float64(junStake)*junDecimal - float64(total)))
			eightProfit := int64(math.Round(float64(eightStake)*eightDecimal - float64(total)))
			if junProfit <= 0 || eightProfit <= 0 {
				continue
			}
			minimumProfit := junProfit
			if eightProfit < minimumProfit {
				minimumProfit = eightProfit
			}
			if minimumProfit > bestProfit || (minimumProfit == bestProfit && total > bestTotal) {
				bestJun, bestEight, bestProfit, bestTotal = junStake, eightStake, minimumProfit, total
			}
		}
	}
	return bestJun, bestEight, bestProfit, bestJun > 0 && bestEight > 0
}

func preparedBalancesCannotFund(totalStakeVND int64, jun, eight *preparedLiveLeg, balanceFloorVND int64) bool {
	if totalStakeVND <= 0 || jun == nil || eight == nil {
		return true
	}
	junMinimum := alignUp(jun.response.MinimumStakeVND, jun.response.StakeIncrementVND)
	eightMinimum := alignUp(eight.response.MinimumStakeVND, eight.response.StakeIncrementVND)
	junMaximum := alignDown(minPositiveInt64(
		jun.response.MaximumStakeVND,
		spendableBalance(jun.response.BalanceVND, balanceFloorVND),
		totalStakeVND-eightMinimum,
	), jun.response.StakeIncrementVND)
	eightMaximum := alignDown(minPositiveInt64(
		eight.response.MaximumStakeVND,
		spendableBalance(eight.response.BalanceVND, balanceFloorVND),
		totalStakeVND-junMinimum,
	), eight.response.StakeIncrementVND)
	return junMinimum <= 0 || eightMinimum <= 0 ||
		junMaximum < junMinimum || eightMaximum < eightMinimum ||
		junMaximum+eightMaximum < totalStakeVND
}

func stakeCandidates(ideal float64, minimum, maximum, increment int64) []int64 {
	if increment <= 0 || minimum <= 0 || maximum < minimum {
		return nil
	}
	if ideal < float64(minimum) {
		ideal = float64(minimum)
	}
	if ideal > float64(maximum) {
		ideal = float64(maximum)
	}
	floor := alignDown(int64(math.Floor(ideal)), increment)
	ceil := alignUp(int64(math.Ceil(ideal)), increment)
	return uniquePositiveInt64([]int64{
		minimum, maximum, floor, ceil,
		floor - increment, floor + increment, ceil - increment, ceil + increment,
	})
}

func validateAcceptedTicket(
	attempt models.BetAttempt,
	response dto.CollectorLiveBetResponse,
	expectedOdds float64,
	expectedStake int64,
	now time.Time,
) error {
	if response.Type != "bet_result" || response.Result != "ticket_accepted" ||
		response.TicketID == "" || response.StakeVND != expectedStake ||
		!finiteMalayOdds(response.AcceptedOdds) ||
		math.Abs(response.AcceptedOdds-expectedOdds) > liveOddsTolerance ||
		attempt.IdempotencyKey != response.IdempotencyKey || response.ObservedAt.IsZero() {
		return errors.New("accepted ticket response is incomplete or mismatched")
	}
	age := now.UTC().Sub(response.ObservedAt.UTC())
	if age < -liveClockTolerance || age > livePreparedMaxAge {
		return errors.New("accepted ticket response is stale")
	}
	return nil
}

func validateOddsChanged(
	response dto.CollectorLiveBetResponse,
	submittedOdds float64,
	now time.Time,
) error {
	if response.Type != "bet_result" || response.Result != "odds_changed" ||
		!response.ConfirmationRequired || !finiteMalayOdds(response.OfferedOdds) ||
		math.Abs(response.SubmittedOdds-submittedOdds) > liveOddsTolerance ||
		math.Abs(response.OfferedOdds-response.SubmittedOdds) <= liveOddsTolerance ||
		response.ObservedAt.IsZero() {
		return errors.New("odds-change response is invalid")
	}
	age := now.UTC().Sub(response.ObservedAt.UTC())
	if age < -liveClockTolerance || age > livePreparedMaxAge {
		return errors.New("odds-change response is stale")
	}
	return nil
}

func acceptedTicketsProfitable(exposure models.BetExposure) bool {
	junDecimal, junOK := malayDecimalOdds(exposure.Jun88AcceptedOdds)
	hedgeDecimal, hedgeOK := malayDecimalOdds(exposure.HedgeAcceptedOdds)
	if !junOK || !hedgeOK || exposure.Jun88StakeVND <= 0 || exposure.HedgeAcceptedStakeVND <= 0 {
		return false
	}
	total := exposure.Jun88StakeVND + exposure.HedgeAcceptedStakeVND
	return int64(math.Round(float64(exposure.Jun88StakeVND)*junDecimal-float64(total))) > 0 &&
		int64(math.Round(float64(exposure.HedgeAcceptedStakeVND)*hedgeDecimal-float64(total))) > 0
}

func encodeLiveAction(action *models.BetAction, legs []dto.BetActionLegView) error {
	encoded, err := json.Marshal(legs)
	if err != nil {
		return err
	}
	action.Legs = encoded
	if len(action.Events) == 0 {
		action.Events = []byte("[]")
	}
	return nil
}

func liveConfirmationRevision(item dto.SurebetView) string {
	parts := make([]string, 0, len(item.Legs))
	for _, leg := range item.Legs {
		parts = append(parts, strings.Join([]string{
			liveLegIdentity(leg), leg.ProviderRef, leg.SourceEventID,
			fmt.Sprintf("%.8f", leg.Odds), fmt.Sprintf("%.8f", leg.RawOdds), leg.OddsFormat,
		}, "|"))
	}
	sort.Strings(parts)
	digest := sha256.Sum256([]byte(item.ID + "|" + strings.Join(parts, "|")))
	return hex.EncodeToString(digest[:])
}

func liveHedgeQuoteRevision(response dto.CollectorLiveBetResponse, revision int) string {
	digest := sha256.Sum256([]byte(fmt.Sprintf(
		"%s|%s|%.8f|%.8f|%d",
		response.PrepareID, response.SlipFingerprint,
		response.DisplayedOdds, response.RawOdds, revision,
	)))
	return hex.EncodeToString(digest[:])
}

func liveLegIdentity(leg dto.SurebetLegView) string {
	return strings.Join([]string{leg.BookmakerID, leg.LobbyID, leg.FixtureID, leg.MarketID, leg.OutcomeID}, ":")
}

func liveSourceForLeg(leg dto.SurebetLegView) dto.CollectorSource {
	collectorID := leg.BookmakerID
	if leg.BookmakerID == "jun88" && leg.LobbyID == "cmd" {
		collectorID = "jun88-cmd"
	}
	return dto.CollectorSource{CollectorID: collectorID, BookmakerID: leg.BookmakerID, LobbyID: leg.LobbyID}
}

func spendableBalance(balance, floor int64) int64 {
	if balance <= floor {
		return 0
	}
	return balance - floor
}

func offeredRawOdds(malay float64) float64 {
	if malay >= 0 {
		return malay
	}
	return -1 / malay
}

func errorMessage(err error, fallback string) string {
	if err != nil && strings.TrimSpace(err.Error()) != "" {
		return err.Error()
	}
	if strings.TrimSpace(fallback) != "" {
		return fallback
	}
	return "live bet command failed"
}

func (s *LiveExecutionService) liveCommandExpiry(deadline time.Time) (time.Time, error) {
	expiresAt := s.now().UTC().Add(s.cfg.CommandTimeout)
	if deadline.Before(expiresAt) {
		expiresAt = deadline.UTC()
	}
	if !expiresAt.After(s.now().UTC()) {
		return time.Time{}, errors.New("confirmed surebet deadline expired")
	}
	return expiresAt, nil
}

var _ interface{ Trigger(dto.SurebetView) } = (*LiveExecutionService)(nil)
