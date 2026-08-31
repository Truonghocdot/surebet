package betaction

import (
	"errors"
	"math"
	"strings"
	"time"

	"surebet/backend/internal/models"
)

const (
	StatusAbortedNoExposure = "aborted_no_exposure"
	StatusUnhedgedClosed    = "unhedged_closed"
	StatusDryRunCompleted   = "dry_run_completed"
	MaxJunRepriceRevisions  = 3

	AttemptPhasePrepare   = "prepare"
	AttemptPhaseCommit    = "commit"
	AttemptPhaseCancel    = "cancel"
	AttemptPhaseReconcile = "reconcile"

	AttemptStatusBeforeSend        = "before_send"
	AttemptStatusSubmitStarted     = "submit_started"
	AttemptStatusResponseReceived  = "response_received"
	AttemptStatusAwaitingReconcile = "awaiting_reconcile"

	ExposureStatusOpen              = "exposure_open"
	ExposureStatusHedging           = "hedging"
	ExposureStatusSubmissionUnknown = "submission_unknown"
	ExposureStatusCompleted         = "completed"
	ExposureStatusUnhedgedClosed    = "unhedged_closed"
	ExposureStatusManualReview      = "manual_review"
)

var (
	ErrInvalidStateTransition        = errors.New("invalid bet execution state transition")
	ErrInvalidRiskLimits             = errors.New("invalid live bet risk limits")
	ErrInvalidHedgeTerms             = errors.New("invalid exposure hedge terms")
	ErrNoProfitableHedge             = errors.New("no profitable hedge stake is available")
	ErrQuoteRevisionAlreadyEvaluated = errors.New("hedge quote revision was already evaluated")
	ErrJunRepriceLimitReached        = errors.New("Jun88 reprice revision limit reached")
)

type LiveRiskLimits struct {
	TotalStakeVND         int64
	AvailableBalanceVND   int64
	BalanceFloorVND       int64
	MaximumActionStakeVND int64
}

// ValidateFixedStakeRisk deliberately has no live defaults. The orchestration
// layer must supply an explicit stake and all account risk limits.
func ValidateFixedStakeRisk(limits LiveRiskLimits) error {
	if limits.TotalStakeVND <= 0 || limits.AvailableBalanceVND < 0 ||
		limits.BalanceFloorVND < 0 || limits.MaximumActionStakeVND <= 0 ||
		limits.BalanceFloorVND > limits.AvailableBalanceVND {
		return ErrInvalidRiskLimits
	}
	if limits.TotalStakeVND > limits.MaximumActionStakeVND ||
		limits.TotalStakeVND > limits.AvailableBalanceVND-limits.BalanceFloorVND {
		return ErrInvalidRiskLimits
	}
	return nil
}

type HedgeConstraints struct {
	MinimumStakeVND      int64
	MaximumStakeVND      int64
	StakeIncrementVND    int64
	AvailableBalanceVND  int64
	MaximumTotalStakeVND int64
}

type HedgePlan struct {
	StakeVND         int64
	JunProfitVND     int64
	HedgeProfitVND   int64
	JunDecimalOdds   float64
	HedgeDecimalOdds float64
}

// CalculateProfitableHedge finds the allowed stake closest to equal payout.
// Both outcome profits are rounded to whole VND and must remain strictly > 0.
// It intentionally does not apply the opening two-negative rule: once Jun88
// has issued a ticket, actual two-outcome P&L is the only hedge gate.
func CalculateProfitableHedge(
	junStakeVND int64,
	junAcceptedMalayOdds float64,
	hedgeMalayOdds float64,
	constraints HedgeConstraints,
) (HedgePlan, error) {
	junDecimal, junOK := malayDecimalOdds(junAcceptedMalayOdds)
	hedgeDecimal, hedgeOK := malayDecimalOdds(hedgeMalayOdds)
	if junStakeVND <= 0 || !junOK || !hedgeOK || constraints.StakeIncrementVND <= 0 ||
		constraints.MinimumStakeVND < 0 || constraints.MaximumStakeVND <= 0 ||
		constraints.AvailableBalanceVND <= 0 || constraints.MaximumTotalStakeVND <= junStakeVND {
		return HedgePlan{}, ErrInvalidHedgeTerms
	}

	maximumStake := minPositiveInt64(
		constraints.MaximumStakeVND,
		constraints.AvailableBalanceVND,
		constraints.MaximumTotalStakeVND-junStakeVND,
	)
	minimumStake := constraints.MinimumStakeVND
	if minimumStake == 0 {
		minimumStake = constraints.StakeIncrementVND
	}
	minimumStake = alignUp(minimumStake, constraints.StakeIncrementVND)
	maximumStake = alignDown(maximumStake, constraints.StakeIncrementVND)
	if minimumStake <= 0 || maximumStake < minimumStake {
		return HedgePlan{}, ErrNoProfitableHedge
	}

	equalizedStake := float64(junStakeVND) * junDecimal / hedgeDecimal
	if math.IsNaN(equalizedStake) || equalizedStake <= 0 {
		return HedgePlan{}, ErrInvalidHedgeTerms
	}
	if math.IsInf(equalizedStake, 1) || equalizedStake > float64(maximumStake) {
		equalizedStake = float64(maximumStake)
	}
	if equalizedStake < float64(minimumStake) {
		equalizedStake = float64(minimumStake)
	}
	candidates := uniquePositiveInt64([]int64{
		alignDown(int64(math.Floor(equalizedStake)), constraints.StakeIncrementVND),
		alignUp(int64(math.Ceil(equalizedStake)), constraints.StakeIncrementVND),
		minimumStake,
		maximumStake,
	})

	best := HedgePlan{}
	bestMinimumProfit := int64(math.MinInt64)
	for _, stake := range candidates {
		if stake < minimumStake || stake > maximumStake {
			continue
		}
		totalStake := junStakeVND + stake
		junProfit := int64(math.Round(float64(junStakeVND)*junDecimal - float64(totalStake)))
		hedgeProfit := int64(math.Round(float64(stake)*hedgeDecimal - float64(totalStake)))
		if junProfit <= 0 || hedgeProfit <= 0 {
			continue
		}
		minimumProfit := junProfit
		if hedgeProfit < minimumProfit {
			minimumProfit = hedgeProfit
		}
		if minimumProfit > bestMinimumProfit ||
			(minimumProfit == bestMinimumProfit && (best.StakeVND == 0 || stake < best.StakeVND)) {
			bestMinimumProfit = minimumProfit
			best = HedgePlan{
				StakeVND: stake, JunProfitVND: junProfit, HedgeProfitVND: hedgeProfit,
				JunDecimalOdds: junDecimal, HedgeDecimalOdds: hedgeDecimal,
			}
		}
	}
	if best.StakeVND == 0 {
		return HedgePlan{}, ErrNoProfitableHedge
	}
	return best, nil
}

type HedgeQuote struct {
	BookmakerID         string
	FixtureID           string
	MarketID            string
	OutcomeID           string
	ProviderReference   string
	Revision            string
	MalayOdds           float64
	ObservedAt          time.Time
	AvailableBalanceVND int64
}

// EvaluateExposureHedge validates the exact complementary 8xbet selection and
// records the quote revision even when it is not yet profitable.
func EvaluateExposureHedge(
	exposure *models.BetExposure,
	quote HedgeQuote,
) (HedgePlan, error) {
	if exposure == nil || exposure.Status != ExposureStatusOpen {
		return HedgePlan{}, ErrInvalidHedgeTerms
	}
	if strings.TrimSpace(quote.Revision) == "" || quote.ObservedAt.IsZero() ||
		quote.BookmakerID != exposure.HedgeBookmakerID ||
		quote.FixtureID != exposure.HedgeFixtureID || quote.MarketID != exposure.HedgeMarketID ||
		quote.OutcomeID != exposure.HedgeOutcomeID ||
		quote.ProviderReference != exposure.HedgeProviderReference {
		return HedgePlan{}, ErrInvalidHedgeTerms
	}
	if quote.Revision == exposure.LastQuoteRevision {
		return HedgePlan{}, ErrQuoteRevisionAlreadyEvaluated
	}

	exposure.CurrentHedgeOdds = quote.MalayOdds
	exposure.LastQuoteRevision = quote.Revision
	observedAt := quote.ObservedAt.UTC()
	exposure.LastQuoteObservedAt = &observedAt
	exposure.RequiredHedgeStakeVND = 0
	exposure.ProjectedJunProfitVND = 0
	exposure.ProjectedHedgeProfitVND = 0

	plan, err := CalculateProfitableHedge(
		exposure.Jun88StakeVND,
		exposure.Jun88AcceptedOdds,
		quote.MalayOdds,
		HedgeConstraints{
			MinimumStakeVND:      exposure.HedgeMinimumStakeVND,
			MaximumStakeVND:      exposure.HedgeMaximumStakeVND,
			StakeIncrementVND:    exposure.HedgeStakeIncrementVND,
			AvailableBalanceVND:  quote.AvailableBalanceVND,
			MaximumTotalStakeVND: exposure.MaximumTotalStakeVND,
		},
	)
	if err != nil {
		return HedgePlan{}, err
	}
	exposure.RequiredHedgeStakeVND = plan.StakeVND
	exposure.ProjectedJunProfitVND = plan.JunProfitVND
	exposure.ProjectedHedgeProfitVND = plan.HedgeProfitVND
	return plan, nil
}

func ValidateOpenExposure(exposure models.BetExposure) error {
	if exposure.ID == "" || exposure.IdempotencyKey == "" || exposure.ActionID == "" ||
		exposure.AccountID == "" || exposure.Status != ExposureStatusOpen || exposure.Currency != "VND" ||
		exposure.Jun88AttemptID == "" || exposure.Jun88TicketID == "" || exposure.Jun88LegID == "" ||
		exposure.Jun88ProviderReference == "" || exposure.Jun88StakeVND <= 0 ||
		!finiteMalayOdds(exposure.Jun88AcceptedOdds) || exposure.Jun88AcceptedAt.IsZero() ||
		exposure.HedgeBookmakerID != "8xbet" || exposure.HedgeLegID == "" ||
		exposure.HedgeFixtureID == "" || exposure.HedgeMarketID == "" || exposure.HedgeOutcomeID == "" ||
		exposure.HedgeProviderReference == "" || exposure.HedgeStakeIncrementVND <= 0 ||
		exposure.MaximumTotalStakeVND <= exposure.Jun88StakeVND || exposure.OpenedAt.IsZero() {
		return ErrInvalidHedgeTerms
	}
	return nil
}

func TransitionBetAction(action *models.BetAction, next string, at time.Time) error {
	if action == nil || !actionTransitionAllowed(action.Status, next) || at.IsZero() {
		return ErrInvalidStateTransition
	}
	action.Status = next
	if isTerminalActionStatus(next) {
		completedAt := at.UTC()
		action.CompletedAt = &completedAt
	} else {
		action.CompletedAt = nil
	}
	switch next {
	case StatusCompleted, StatusDryRunCompleted, StatusAbortedNoExposure, StatusSelectionRejected, StatusFailed, StatusUnhedgedClosed:
		action.ExposureOpen = false
	}
	return nil
}

func AdvanceJunRepriceRevision(action *models.BetAction) (int, error) {
	if action == nil || action.ExposureOpen || action.ExposureID != "" ||
		(action.Status != StatusPlacingJun88 && action.Status != StatusAwaitingOddsConfirmation) {
		return 0, ErrInvalidStateTransition
	}
	if action.RepriceRevision >= MaxJunRepriceRevisions {
		return action.RepriceRevision, ErrJunRepriceLimitReached
	}
	action.RepriceRevision++
	return action.RepriceRevision, nil
}

func TransitionBetAttempt(attempt *models.BetAttempt, next string, at time.Time) error {
	if attempt == nil || at.IsZero() {
		return ErrInvalidStateTransition
	}
	allowed := false
	switch attempt.Status {
	case AttemptStatusBeforeSend:
		allowed = next == AttemptStatusSubmitStarted
	case AttemptStatusSubmitStarted:
		allowed = next == AttemptStatusResponseReceived || next == AttemptStatusAwaitingReconcile
	case AttemptStatusAwaitingReconcile:
		allowed = next == AttemptStatusResponseReceived
	}
	if !allowed {
		return ErrInvalidStateTransition
	}
	at = at.UTC()
	attempt.Status = next
	switch next {
	case AttemptStatusSubmitStarted:
		attempt.SubmitStartedAt = &at
	case AttemptStatusResponseReceived:
		attempt.ResponseReceivedAt = &at
	}
	return nil
}

func TransitionBetExposure(exposure *models.BetExposure, next string, at time.Time) error {
	if exposure == nil || !exposureTransitionAllowed(exposure.Status, next) || at.IsZero() {
		return ErrInvalidStateTransition
	}
	at = at.UTC()
	exposure.Status = next
	switch next {
	case ExposureStatusCompleted:
		exposure.CompletedAt = &at
		exposure.ClosedAt = &at
	case ExposureStatusUnhedgedClosed:
		exposure.CompletedAt = nil
		exposure.ClosedAt = &at
	default:
		exposure.CompletedAt = nil
		exposure.ClosedAt = nil
	}
	return nil
}

func isTerminalActionStatus(status string) bool {
	switch status {
	case StatusCompleted, StatusDryRunCompleted, StatusAbortedNoExposure, StatusSelectionRejected, StatusFailed, StatusUnhedgedClosed:
		return true
	default:
		return false
	}
}

func actionTransitionAllowed(current, next string) bool {
	if current == next {
		return false
	}
	switch current {
	case StatusSelecting:
		return oneOf(next, StatusReady, StatusSelectionRejected, StatusFailed, StatusAbortedNoExposure)
	case StatusReady:
		return oneOf(next, StatusPlacingJun88, StatusDryRunCompleted, StatusSelectionRejected, StatusFailed, StatusAbortedNoExposure)
	case StatusPlacingJun88:
		return oneOf(next, StatusJun88TicketReceived, StatusAwaitingOddsConfirmation,
			StatusSubmissionUnknown, StatusFailed, StatusAbortedNoExposure)
	case StatusAwaitingOddsConfirmation:
		return oneOf(next, StatusReady, StatusPlacingJun88, StatusAbortedNoExposure, StatusSubmissionUnknown)
	case StatusJun88TicketReceived:
		return oneOf(next, StatusPlacingEightXBet, StatusExposureOpen, StatusSubmissionUnknown)
	case StatusPlacingEightXBet:
		return oneOf(next, StatusCompleted, StatusExposureOpen, StatusSubmissionUnknown)
	case StatusExposureOpen:
		return oneOf(next, StatusPlacingEightXBet, StatusCompleted, StatusSubmissionUnknown, StatusUnhedgedClosed)
	case StatusSubmissionUnknown:
		return oneOf(next, StatusJun88TicketReceived, StatusExposureOpen, StatusCompleted,
			StatusAbortedNoExposure, StatusFailed, StatusUnhedgedClosed)
	default:
		return false
	}
}

func exposureTransitionAllowed(current, next string) bool {
	if current == next {
		return false
	}
	switch current {
	case ExposureStatusOpen:
		return oneOf(next, ExposureStatusHedging, ExposureStatusSubmissionUnknown,
			ExposureStatusUnhedgedClosed, ExposureStatusManualReview)
	case ExposureStatusHedging:
		return oneOf(next, ExposureStatusCompleted, ExposureStatusOpen,
			ExposureStatusSubmissionUnknown, ExposureStatusManualReview)
	case ExposureStatusSubmissionUnknown:
		return oneOf(next, ExposureStatusCompleted, ExposureStatusOpen,
			ExposureStatusUnhedgedClosed, ExposureStatusManualReview)
	case ExposureStatusManualReview:
		return oneOf(next, ExposureStatusOpen, ExposureStatusCompleted, ExposureStatusUnhedgedClosed)
	default:
		return false
	}
}

func oneOf(value string, candidates ...string) bool {
	for _, candidate := range candidates {
		if value == candidate {
			return true
		}
	}
	return false
}

func alignDown(value, increment int64) int64 {
	if value <= 0 || increment <= 0 {
		return 0
	}
	return value - value%increment
}

func alignUp(value, increment int64) int64 {
	if value <= 0 || increment <= 0 {
		return 0
	}
	remainder := value % increment
	if remainder == 0 {
		return value
	}
	if value > math.MaxInt64-(increment-remainder) {
		return 0
	}
	return value + increment - remainder
}

func minPositiveInt64(values ...int64) int64 {
	result := int64(0)
	for _, value := range values {
		if value <= 0 {
			continue
		}
		if result == 0 || value < result {
			result = value
		}
	}
	return result
}

func uniquePositiveInt64(values []int64) []int64 {
	seen := make(map[int64]struct{}, len(values))
	result := make([]int64, 0, len(values))
	for _, value := range values {
		if value <= 0 {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}
