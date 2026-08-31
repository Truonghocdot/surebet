package betaction

import (
	"context"
	"errors"
	"sort"
	"strings"
	"sync"
	"time"

	"surebet/backend/internal/dto"
	"surebet/backend/internal/models"
)

type ExposureHedgeNotifier struct {
	execution *LiveExecutionService
	inflight  sync.Map
}

func NewExposureHedgeNotifier(execution *LiveExecutionService) *ExposureHedgeNotifier {
	return &ExposureHedgeNotifier{execution: execution}
}

func (n *ExposureHedgeNotifier) Trigger(quotes []models.OddsQuote) {
	if n == nil || n.execution == nil || !n.execution.cfg.Enabled || !n.execution.cfg.CommitEnabled {
		return
	}
	cloned := append([]models.OddsQuote(nil), quotes...)
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 6*n.execution.cfg.CommandTimeout)
		defer cancel()
		_ = n.Notify(ctx, cloned)
	}()
}

func (n *ExposureHedgeNotifier) Notify(ctx context.Context, quotes []models.OddsQuote) error {
	if n == nil || n.execution == nil || !n.execution.cfg.Enabled || !n.execution.cfg.CommitEnabled {
		return ErrLiveExecutionDisabled
	}
	exposures, err := n.execution.exposures.ListDue(ctx, n.execution.now().UTC(), 100)
	if err != nil {
		return err
	}
	var firstErr error
	for _, exposure := range exposures {
		quote, found := newestExactHedgeQuote(exposure, quotes)
		if !found {
			continue
		}
		if _, loaded := n.inflight.LoadOrStore(exposure.ID, struct{}{}); loaded {
			continue
		}
		err := n.process(ctx, exposure, quote)
		n.inflight.Delete(exposure.ID)
		if firstErr == nil && err != nil {
			firstErr = err
		}
	}
	return firstErr
}

func (n *ExposureHedgeNotifier) process(
	ctx context.Context,
	exposure models.BetExposure,
	quote models.OddsQuote,
) error {
	s := n.execution
	now := s.now().UTC()
	leased, acquired, err := s.exposures.TryAcquireLease(
		ctx, exposure.ID, s.owner, exposure.Version, now, now.Add(s.cfg.LeaseDuration),
	)
	if err != nil || !acquired {
		return err
	}
	exposure = leased
	defer func() {
		current, getErr := s.exposures.GetByID(context.WithoutCancel(ctx), exposure.ID)
		if getErr == nil && current.LeaseOwner == s.owner {
			_, _ = s.exposures.ReleaseLease(
				context.WithoutCancel(ctx), current.ID, s.owner, current.Version, s.now(),
			)
		}
	}()

	action, err := s.actions.GetByID(ctx, exposure.ActionID)
	if err != nil {
		return err
	}
	view, err := toView(action)
	if err != nil {
		return err
	}
	if terminalMarketState(quote.MatchState) {
		return n.closeUnhedged(ctx, &action, view.Legs, &exposure, quote)
	}
	observedAt := liveQuoteObservedAt(quote)
	age := now.Sub(observedAt)
	if quote.Suspended || age < -liveClockTolerance || age > livePreparedMaxAge {
		return nil
	}

	reserved, acquired, err := s.actions.TryReserveAccountStake(
		ctx, action.ID, action.AccountID, s.owner, action.Version,
		action.TotalStakeVND, now, now.Add(s.cfg.LeaseDuration),
	)
	if err != nil || !acquired {
		return err
	}
	action = reserved
	prepareNumber, commitNumber, err := s.nextEightXBetAttemptNumbers(ctx, action.ID)
	if err != nil {
		return err
	}
	leg := dto.SurebetLegView{
		BookmakerID: "8xbet", LobbyID: "default",
		FixtureID: quote.FixtureID, MarketID: quote.MarketID, OutcomeID: quote.OutcomeID,
		OutcomeName: quote.OutcomeName, Odds: quote.Odds, RawOdds: quote.RawOdds,
		OddsFormat: quote.OddsFormat, SourceEventID: quote.SourceEventID,
		ProviderRef: quote.ProviderReference, AvailableStake: quote.AvailableStake,
		ObservedAt: observedAt,
	}
	prepared, err := s.prepareLeg(
		ctx, action, 1, leg, prepareNumber, now.Add(s.cfg.CommandTimeout),
	)
	if err != nil {
		exposure.LastFailureCode = "hedge_prepare_failed"
		exposure.LastFailureMessage = err.Error()
		exposure.UpdatedAt = s.now()
		updated, updateErr := s.exposures.UpdateCAS(context.WithoutCancel(ctx), exposure, exposure.Version)
		if updateErr == nil {
			exposure = updated
			s.publishExposure(exposure)
		}
		return err
	}
	legs := view.Legs
	if len(legs) != 2 {
		s.cancelPrepared(context.WithoutCancel(ctx), action, *prepared)
		return errors.New("live action legs are incomplete")
	}
	prepared.view = legs[1]
	prepared.view.SelectedOdds = prepared.response.DisplayedOdds
	prepared.view.ObservedAt = prepared.response.ObservedAt
	prepared.view.Status = "prepared"
	_, err = s.commitEightXBet(ctx, action, legs, exposure, *prepared, commitNumber)
	return err
}

func (n *ExposureHedgeNotifier) closeUnhedged(
	ctx context.Context,
	action *models.BetAction,
	legs []dto.BetActionLegView,
	exposure *models.BetExposure,
	quote models.OddsQuote,
) error {
	s := n.execution
	closedAt := liveQuoteObservedAt(quote)
	if closedAt.IsZero() {
		closedAt = s.now().UTC()
	}
	exposure.MarketClosedAt = &closedAt
	exposure.LastFailureCode = "hedge_market_closed"
	exposure.LastFailureMessage = "8xbet complementary market closed before a profitable hedge was available"
	if err := TransitionBetExposure(exposure, ExposureStatusUnhedgedClosed, s.now()); err != nil {
		return err
	}
	updated, err := s.exposures.UpdateCAS(context.WithoutCancel(ctx), *exposure, exposure.Version)
	if err != nil {
		return err
	}
	*exposure = updated
	action.ErrorCode = exposure.LastFailureCode
	action.ErrorMessage = exposure.LastFailureMessage
	if err := s.transitionAction(
		ctx, action, legs, StatusUnhedgedClosed,
		"unhedged_exposure_closed", exposure.LastFailureMessage,
	); err != nil {
		return err
	}
	s.publishExposure(*exposure)
	s.releaseActionReservation(ctx, action)
	return nil
}

func (s *LiveExecutionService) nextEightXBetAttemptNumbers(
	ctx context.Context,
	actionID string,
) (prepareNumber, commitNumber int, err error) {
	attempts, err := s.attempts.ListByAction(ctx, actionID, liveAttemptQueryLimit)
	if err != nil {
		return 0, 0, err
	}
	prepareNumber, commitNumber = 1, 1
	for _, attempt := range attempts {
		if attempt.BookmakerID != "8xbet" {
			continue
		}
		if attempt.Phase == AttemptPhasePrepare && attempt.AttemptNumber >= prepareNumber {
			prepareNumber = attempt.AttemptNumber + 1
		}
		if attempt.Phase == AttemptPhaseCommit && attempt.AttemptNumber >= commitNumber {
			commitNumber = attempt.AttemptNumber + 1
		}
	}
	return prepareNumber, commitNumber, nil
}

func newestExactHedgeQuote(
	exposure models.BetExposure,
	quotes []models.OddsQuote,
) (models.OddsQuote, bool) {
	matches := make([]models.OddsQuote, 0, 1)
	for _, quote := range quotes {
		if quote.BookmakerID == exposure.HedgeBookmakerID && quote.LobbyID == "default" &&
			quote.FixtureID == exposure.HedgeFixtureID && quote.MarketID == exposure.HedgeMarketID &&
			quote.OutcomeID == exposure.HedgeOutcomeID &&
			quote.ProviderReference == exposure.HedgeProviderReference {
			matches = append(matches, quote)
		}
	}
	if len(matches) == 0 {
		return models.OddsQuote{}, false
	}
	sort.Slice(matches, func(i, j int) bool {
		return liveQuoteObservedAt(matches[i]).After(liveQuoteObservedAt(matches[j]))
	})
	return matches[0], true
}

func liveQuoteObservedAt(quote models.OddsQuote) time.Time {
	if !quote.MarketObservedAt.IsZero() {
		return quote.MarketObservedAt.UTC()
	}
	if !quote.LastObservedAt.IsZero() {
		return quote.LastObservedAt.UTC()
	}
	return quote.CollectedAt.UTC()
}

func terminalMarketState(state string) bool {
	switch strings.ToLower(strings.TrimSpace(state)) {
	case "finished", "ended", "closed", "settled", "cancelled", "canceled", "abandoned":
		return true
	default:
		return false
	}
}
