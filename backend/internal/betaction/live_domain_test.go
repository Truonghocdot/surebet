package betaction

import (
	"errors"
	"testing"
	"time"

	"surebet/backend/internal/models"
)

func TestCalculateProfitableHedgeRoundsToBookmakerIncrement(t *testing.T) {
	plan, err := CalculateProfitableHedge(
		48_000,
		-0.92,
		-0.88,
		HedgeConstraints{
			MinimumStakeVND: 20_000, MaximumStakeVND: 100_000,
			StakeIncrementVND: 1_000, AvailableBalanceVND: 80_000,
			MaximumTotalStakeVND: 100_000,
		},
	)
	if err != nil {
		t.Fatalf("calculate hedge: %v", err)
	}
	if plan.StakeVND%1_000 != 0 || plan.StakeVND != 47_000 {
		t.Fatalf("stake was not rounded to the best bookmaker increment: %+v", plan)
	}
	if plan.JunProfitVND <= 0 || plan.HedgeProfitVND <= 0 {
		t.Fatalf("both rounded outcomes must be profitable: %+v", plan)
	}
}

func TestCalculateProfitableHedgeAllowsPositiveMalayOddsAfterJunTicket(t *testing.T) {
	plan, err := CalculateProfitableHedge(
		48_000,
		-0.92,
		0.95,
		HedgeConstraints{
			MinimumStakeVND: 1_000, MaximumStakeVND: 80_000,
			StakeIncrementVND: 1_000, AvailableBalanceVND: 80_000,
			MaximumTotalStakeVND: 105_000,
		},
	)
	if err != nil {
		t.Fatalf("positive Malay hedge should be evaluated by P&L: %v", err)
	}
	if plan.JunProfitVND <= 0 || plan.HedgeProfitVND <= 0 {
		t.Fatalf("positive Malay hedge did not preserve both profits: %+v", plan)
	}
}

func TestCalculateProfitableHedgeRejectsLossAndCoarseRounding(t *testing.T) {
	tests := []struct {
		name         string
		odds         float64
		increment    int64
		maximumTotal int64
	}{
		{name: "unprofitable price", odds: 0.80, increment: 1_000, maximumTotal: 120_000},
		{name: "increment removes profitable interval", odds: -0.88, increment: 20_000, maximumTotal: 120_000},
		{name: "action cap", odds: -0.88, increment: 1_000, maximumTotal: 90_000},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := CalculateProfitableHedge(
				48_000,
				-0.92,
				test.odds,
				HedgeConstraints{
					MinimumStakeVND: test.increment, MaximumStakeVND: 100_000,
					StakeIncrementVND: test.increment, AvailableBalanceVND: 100_000,
					MaximumTotalStakeVND: test.maximumTotal,
				},
			)
			if !errors.Is(err, ErrNoProfitableHedge) {
				t.Fatalf("expected no profitable hedge, got %v", err)
			}
		})
	}
}

func TestEvaluateExposureHedgeRequiresExactComplementAndNewRevision(t *testing.T) {
	exposure := openExposureFixture()
	observedAt := time.Date(2026, time.August, 14, 10, 1, 0, 0, time.UTC)
	quote := HedgeQuote{
		BookmakerID: "8xbet", FixtureID: exposure.HedgeFixtureID,
		MarketID: exposure.HedgeMarketID, OutcomeID: exposure.HedgeOutcomeID,
		ProviderReference: exposure.HedgeProviderReference,
		Revision:          "quote-2", MalayOdds: -0.88, ObservedAt: observedAt,
		AvailableBalanceVND: 100_000,
	}
	plan, err := EvaluateExposureHedge(&exposure, quote)
	if err != nil {
		t.Fatalf("evaluate hedge: %v", err)
	}
	if exposure.RequiredHedgeStakeVND != plan.StakeVND ||
		exposure.ProjectedJunProfitVND != plan.JunProfitVND ||
		exposure.LastQuoteRevision != quote.Revision {
		t.Fatalf("exposure did not retain hedge evaluation: %+v", exposure)
	}
	if _, err := EvaluateExposureHedge(&exposure, quote); !errors.Is(err, ErrQuoteRevisionAlreadyEvaluated) {
		t.Fatalf("same revision must not create another commit opportunity: %v", err)
	}

	mismatch := openExposureFixture()
	quote.Revision = "quote-3"
	quote.ProviderReference = "different-selection"
	if _, err := EvaluateExposureHedge(&mismatch, quote); !errors.Is(err, ErrInvalidHedgeTerms) {
		t.Fatalf("mismatched provider reference must be rejected: %v", err)
	}
}

func TestActionAndExposureTerminalTimestamps(t *testing.T) {
	at := time.Date(2026, time.August, 14, 10, 2, 0, 0, time.UTC)
	action := models.BetAction{Status: StatusPlacingEightXBet, ExposureOpen: true}
	if err := TransitionBetAction(&action, StatusExposureOpen, at); err != nil {
		t.Fatalf("open action exposure: %v", err)
	}
	if action.CompletedAt != nil || !action.ExposureOpen {
		t.Fatalf("open exposure must remain non-terminal: %+v", action)
	}
	if err := TransitionBetAction(&action, StatusUnhedgedClosed, at.Add(time.Second)); err != nil {
		t.Fatalf("close unhedged action: %v", err)
	}
	if action.CompletedAt == nil || action.ExposureOpen {
		t.Fatalf("unhedged_closed must be terminal: %+v", action)
	}

	exposure := openExposureFixture()
	if err := TransitionBetExposure(&exposure, ExposureStatusSubmissionUnknown, at); err != nil {
		t.Fatalf("mark unknown: %v", err)
	}
	if exposure.CompletedAt != nil || exposure.ClosedAt != nil {
		t.Fatalf("submission_unknown must remain resumable: %+v", exposure)
	}
	if err := TransitionBetExposure(&exposure, ExposureStatusOpen, at.Add(time.Second)); err != nil {
		t.Fatalf("reconcile back to open: %v", err)
	}
	if err := TransitionBetExposure(&exposure, ExposureStatusUnhedgedClosed, at.Add(2*time.Second)); err != nil {
		t.Fatalf("close market: %v", err)
	}
	if exposure.CompletedAt != nil || exposure.ClosedAt == nil {
		t.Fatalf("unhedged exposure closes without pretending to be completed: %+v", exposure)
	}
}

func TestAttemptUnknownRequiresReconciliationBeforeResponse(t *testing.T) {
	at := time.Date(2026, time.August, 14, 10, 3, 0, 0, time.UTC)
	attempt := models.BetAttempt{Status: AttemptStatusBeforeSend}
	if err := TransitionBetAttempt(&attempt, AttemptStatusSubmitStarted, at); err != nil {
		t.Fatalf("start submit: %v", err)
	}
	if err := TransitionBetAttempt(&attempt, AttemptStatusAwaitingReconcile, at.Add(time.Second)); err != nil {
		t.Fatalf("mark awaiting reconcile: %v", err)
	}
	if attempt.ResponseReceivedAt != nil {
		t.Fatal("lost response must not be recorded as received")
	}
	if err := TransitionBetAttempt(&attempt, AttemptStatusSubmitStarted, at.Add(2*time.Second)); !errors.Is(err, ErrInvalidStateTransition) {
		t.Fatalf("unknown attempt must not be resubmitted: %v", err)
	}
	if err := TransitionBetAttempt(&attempt, AttemptStatusResponseReceived, at.Add(3*time.Second)); err != nil {
		t.Fatalf("reconcile response: %v", err)
	}
}

func TestJunRepriceRevisionIsBoundedBeforeAnyTicket(t *testing.T) {
	action := models.BetAction{Status: StatusPlacingJun88}
	for revision := 1; revision <= MaxJunRepriceRevisions; revision++ {
		current, err := AdvanceJunRepriceRevision(&action)
		if err != nil || current != revision {
			t.Fatalf("advance revision %d: current=%d err=%v", revision, current, err)
		}
		action.Status = StatusAwaitingOddsConfirmation
	}
	if _, err := AdvanceJunRepriceRevision(&action); !errors.Is(err, ErrJunRepriceLimitReached) {
		t.Fatalf("fourth Jun88 price revision must abort the pre-ticket workflow: %v", err)
	}
	action.ExposureOpen = true
	if _, err := AdvanceJunRepriceRevision(&action); !errors.Is(err, ErrInvalidStateTransition) {
		t.Fatalf("reprice counter must not advance after exposure opens: %v", err)
	}
}

func TestValidateFixedStakeRiskHasNoImplicitLiveDefault(t *testing.T) {
	if err := ValidateFixedStakeRisk(LiveRiskLimits{}); !errors.Is(err, ErrInvalidRiskLimits) {
		t.Fatalf("zero live config must be rejected: %v", err)
	}
	if err := ValidateFixedStakeRisk(LiveRiskLimits{
		TotalStakeVND: 100_000, AvailableBalanceVND: 250_000,
		BalanceFloorVND: 100_000, MaximumActionStakeVND: 100_000,
	}); err != nil {
		t.Fatalf("valid fixed VND risk limits rejected: %v", err)
	}
}

func openExposureFixture() models.BetExposure {
	acceptedAt := time.Date(2026, time.August, 14, 10, 0, 0, 0, time.UTC)
	return models.BetExposure{
		BaseModel:      models.BaseModel{ID: "exposure-1"},
		IdempotencyKey: "exposure:ticket-jun", ActionID: "action-1", AccountID: "account-1",
		Status: ExposureStatusOpen, Currency: "VND", Version: 1,
		Jun88AttemptID: "attempt-jun", Jun88TicketID: "ticket-jun", Jun88LegID: "leg-jun",
		Jun88FixtureID: "fixture-jun", Jun88MarketID: "market-jun", Jun88OutcomeID: "over",
		Jun88ProviderReference: "25212060_Hdp_Home", Jun88AcceptedOdds: -0.92,
		Jun88StakeVND: 48_000, Jun88AcceptedAt: acceptedAt,
		HedgeBookmakerID: "8xbet", HedgeLegID: "leg-8", HedgeFixtureID: "4928833",
		HedgeMarketID: "ah", HedgeOutcomeID: "h", HedgeProviderReference: "1|4928833|ah|h|0",
		MaximumTotalStakeVND: 110_000, HedgeMinimumStakeVND: 1_000,
		HedgeMaximumStakeVND: 100_000, HedgeStakeIncrementVND: 1_000,
		OpenedAt: acceptedAt,
	}
}
