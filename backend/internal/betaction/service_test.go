package betaction

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"surebet/backend/internal/config"
	"surebet/backend/internal/dto"
	"surebet/backend/internal/models"
	"surebet/backend/internal/repository"
)

func TestSimulationSelectsBothThenPlacesJun88BeforeEightXBet(t *testing.T) {
	store := newActionStoreStub()
	simulator := &collectorSimulatorStub{}
	service := simulationService(store, simulator)

	view, err := service.Simulate(context.Background(), confirmedCandidate())
	if err != nil {
		t.Fatalf("simulate: %v", err)
	}
	if view.Status != StatusCompleted || view.ExposureOpen {
		t.Fatalf("unexpected completed action: %+v", view)
	}
	if len(view.Legs) != 2 || view.Legs[0].BookmakerID != "jun88" || view.Legs[1].BookmakerID != "8xbet" {
		t.Fatalf("placement order was not normalized: %+v", view.Legs)
	}
	if view.Legs[0].TicketID == "" || view.Legs[1].TicketID == "" {
		t.Fatalf("both synthetic tickets are required: %+v", view.Legs)
	}
	assertCommandOrder(t, simulator.Commands(), []string{
		"simulate_select_odds", "simulate_select_odds", "simulate_place_bet:jun88", "simulate_place_bet:8xbet",
	})
	if view.Legs[0].StakeVND+view.Legs[1].StakeVND != 100_000 {
		t.Fatalf("stakes do not consume the simulation bankroll: %+v", view.Legs)
	}
}

func TestSimulationStopsWhenJun88ReturnsOddsChanged(t *testing.T) {
	store := newActionStoreStub()
	simulator := &collectorSimulatorStub{junResult: "odds_changed"}
	service := simulationService(store, simulator)

	view, err := service.Simulate(context.Background(), confirmedCandidate())
	if err != nil {
		t.Fatalf("simulate: %v", err)
	}
	if view.Status != StatusAwaitingOddsConfirmation || view.ExposureOpen {
		t.Fatalf("unexpected Jun88 odds-change state: %+v", view)
	}
	if view.CompletedAt != nil {
		t.Fatalf("awaiting confirmation is resumable and must not be completed: %+v", view)
	}
	if view.Legs[0].OfferedOdds != -0.86 || !view.Legs[0].ConfirmationRequired {
		t.Fatalf("new sidebar odds were not retained: %+v", view.Legs[0])
	}
	if view.Legs[0].OfferedPairEligible == nil || !*view.Legs[0].OfferedPairEligible {
		t.Fatalf("repriced pair eligibility was not calculated: %+v", view.Legs[0])
	}
	assertCommandOrder(t, simulator.Commands(), []string{
		"simulate_select_odds", "simulate_select_odds", "simulate_place_bet:jun88",
	})
}

func TestSimulationMarksExposureWhenEightXBetChangesAfterJunTicket(t *testing.T) {
	store := newActionStoreStub()
	simulator := &collectorSimulatorStub{eightResult: "odds_changed"}
	service := simulationService(store, simulator)

	view, err := service.Simulate(context.Background(), confirmedCandidate())
	if err != nil {
		t.Fatalf("simulate: %v", err)
	}
	if view.Status != StatusExposureOpen || !view.ExposureOpen {
		t.Fatalf("second-leg price change must expose the Jun88 ticket: %+v", view)
	}
	if view.CompletedAt != nil {
		t.Fatalf("open exposure must not have completed_at: %+v", view)
	}
	if view.Legs[0].TicketID == "" || view.Legs[1].OfferedOdds != -0.86 {
		t.Fatalf("expected Jun88 ticket and 8xbet offered odds: %+v", view.Legs)
	}
}

func TestSimulationRejectsMixedSignSelectedOddsBeforePlacement(t *testing.T) {
	store := newActionStoreStub()
	simulator := &collectorSimulatorStub{selectedOdds: map[string]float64{"jun88": 0.88}}
	service := simulationService(store, simulator)

	view, err := service.Simulate(context.Background(), confirmedCandidate())
	if err != nil {
		t.Fatalf("simulate: %v", err)
	}
	if view.Status != StatusSelectionRejected {
		t.Fatalf("mixed-sign selection must be rejected: %+v", view)
	}
	for _, command := range simulator.Commands() {
		if command.Type == "simulate_place_bet" {
			t.Fatalf("placement was sent after mixed-sign selection: %+v", command)
		}
	}
}

func TestSimulationIsIdempotentForTheSameConfirmedPair(t *testing.T) {
	store := newActionStoreStub()
	simulator := &collectorSimulatorStub{}
	service := simulationService(store, simulator)
	candidate := confirmedCandidate()
	first, err := service.Simulate(context.Background(), candidate)
	if err != nil {
		t.Fatalf("first simulate: %v", err)
	}
	count := len(simulator.Commands())
	candidate.ConfirmedAt = candidate.ConfirmedAt.Add(time.Second)
	candidate.ValidUntil = candidate.ValidUntil.Add(time.Second)
	for index := range candidate.Legs {
		candidate.Legs[index].ObservedAt = candidate.Legs[index].ObservedAt.Add(time.Second)
	}
	second, err := service.Simulate(context.Background(), candidate)
	if err != nil {
		t.Fatalf("second simulate: %v", err)
	}
	if first.ActionID != second.ActionID || len(simulator.Commands()) != count {
		t.Fatalf("duplicate confirmation started another simulation: first=%s second=%s calls=%d", first.ActionID, second.ActionID, len(simulator.Commands()))
	}
}

func TestSimulationMarksJun88LostResponseAsSubmissionUnknown(t *testing.T) {
	store := newActionStoreStub()
	simulator := &collectorSimulatorStub{placeErrors: map[string]error{
		"jun88": errors.New("simulated response lost"),
	}}
	service := simulationService(store, simulator)

	view, err := service.Simulate(context.Background(), confirmedCandidate())
	if err != nil {
		t.Fatalf("simulate: %v", err)
	}
	if view.Status != StatusSubmissionUnknown || !view.ExposureOpen {
		t.Fatalf("lost Jun88 response must be treated as possible exposure: %+v", view)
	}
	assertCommandOrder(t, simulator.Commands(), []string{
		"simulate_select_odds", "simulate_select_odds", "simulate_place_bet:jun88",
	})
}

func TestSimulationRejectsStaleOrSkewedSelections(t *testing.T) {
	for name, observedAt := range map[string]map[string]time.Time{
		"stale": {
			"jun88": time.Date(2026, time.August, 14, 9, 59, 57, 0, time.UTC),
		},
		"skewed": {
			"jun88": time.Date(2026, time.August, 14, 10, 0, 0, 0, time.UTC),
			"8xbet": time.Date(2026, time.August, 14, 9, 59, 58, 0, time.UTC),
		},
	} {
		t.Run(name, func(t *testing.T) {
			simulator := &collectorSimulatorStub{selectionObservedAt: observedAt}
			service := simulationService(newActionStoreStub(), simulator)
			view, err := service.Simulate(context.Background(), confirmedCandidate())
			if err != nil {
				t.Fatalf("simulate: %v", err)
			}
			if view.Status != StatusSelectionRejected {
				t.Fatalf("invalid selection timing must stop placement: %+v", view)
			}
			for _, command := range simulator.Commands() {
				if command.Type == "simulate_place_bet" {
					t.Fatalf("placement sent after invalid timing: %+v", command)
				}
			}
		})
	}
}

func TestSimulationRejectsInvalidSelectionProvenance(t *testing.T) {
	simulator := &collectorSimulatorStub{invalidProvenance: map[string]bool{"8xbet": true}}
	service := simulationService(newActionStoreStub(), simulator)
	view, err := service.Simulate(context.Background(), confirmedCandidate())
	if err != nil {
		t.Fatalf("simulate: %v", err)
	}
	if view.Status != StatusSelectionRejected {
		t.Fatalf("invalid odds provenance must stop placement: %+v", view)
	}
}

func TestSimulationTreatsMismatchedAcceptedTermsAsUnknown(t *testing.T) {
	simulator := &collectorSimulatorStub{acceptedOdds: map[string]float64{"jun88": -0.80}}
	service := simulationService(newActionStoreStub(), simulator)
	view, err := service.Simulate(context.Background(), confirmedCandidate())
	if err != nil {
		t.Fatalf("simulate: %v", err)
	}
	if view.Status != StatusSubmissionUnknown || !view.ExposureOpen {
		t.Fatalf("mismatched accepted terms may represent a real first ticket: %+v", view)
	}
}

func TestSimulationRequiresCurrentHardConfirmation(t *testing.T) {
	service := simulationService(newActionStoreStub(), &collectorSimulatorStub{})
	candidate := confirmedCandidate()
	candidate.VerificationStatus = "candidate"
	if _, err := service.Simulate(context.Background(), candidate); !errors.Is(err, ErrInvalidCandidate) {
		t.Fatalf("non-confirmed candidate must be rejected: %v", err)
	}
	candidate = confirmedCandidate()
	candidate.ValidUntil = time.Date(2026, time.August, 14, 9, 59, 59, 0, time.UTC)
	if _, err := service.Simulate(context.Background(), candidate); !errors.Is(err, ErrInvalidCandidate) {
		t.Fatalf("expired confirmation must be rejected: %v", err)
	}
}

func simulationService(store Repository, simulator CollectorSimulator) *Service {
	service := NewService(
		store,
		simulator,
		config.AutoBetSimulationConfig{
			Enabled: true, TotalStakeVND: 100_000, CommandTimeout: time.Second,
		},
		nil,
		nil,
	)
	service.now = func() time.Time {
		return time.Date(2026, time.August, 14, 10, 0, 0, 0, time.UTC)
	}
	return service
}

func confirmedCandidate() dto.SurebetView {
	observedAt := time.Date(2026, time.August, 14, 9, 59, 59, 0, time.UTC)
	return dto.SurebetView{
		ID: "opportunity-1", VerificationStatus: "confirmed", ConfirmedAt: observedAt,
		ValidUntil: observedAt.Add(10 * time.Second),
		Legs: []dto.SurebetLegView{
			{
				BookmakerID: "8xbet", LobbyID: "default", FixtureID: "8-fixture",
				MarketID: "o-u-ou", OutcomeID: "8-under", OutcomeName: "Under 2.5",
				Odds: -0.88, ObservedAt: observedAt,
			},
			{
				BookmakerID: "jun88", LobbyID: "cmd", FixtureID: "jun-fixture",
				MarketID: "ou", OutcomeID: "jun-over", OutcomeName: "Over 2.5",
				Odds: -0.92, ObservedAt: observedAt,
			},
		},
	}
}

type collectorSimulatorStub struct {
	mu                  sync.Mutex
	commands            []recordedCommand
	junResult           string
	eightResult         string
	selectedOdds        map[string]float64
	selectionObservedAt map[string]time.Time
	acceptedOdds        map[string]float64
	placeErrors         map[string]error
	invalidProvenance   map[string]bool
}

type recordedCommand struct {
	Type      string
	Bookmaker string
}

func (s *collectorSimulatorStub) SimulateBet(
	_ context.Context,
	source dto.CollectorSource,
	command dto.CollectorSimulatedBetRequest,
) (dto.CollectorSimulatedBetResponse, error) {
	s.mu.Lock()
	s.commands = append(s.commands, recordedCommand{Type: command.Type, Bookmaker: source.BookmakerID})
	s.mu.Unlock()
	now := time.Date(2026, time.August, 14, 10, 0, 0, 0, time.UTC)
	if observedAt, ok := s.selectionObservedAt[source.BookmakerID]; ok && command.Type == "simulate_select_odds" {
		now = observedAt
	}
	if command.Type == "simulate_select_odds" {
		odds := command.ExpectedOdds
		if selected, ok := s.selectedOdds[source.BookmakerID]; ok {
			odds = selected
		}
		rawOdds := odds
		oddsFormat := "malay"
		if source.BookmakerID == "8xbet" {
			rawOdds = -1 / odds
			oddsFormat = "indonesian"
		}
		sourceEventID := source.BookmakerID + "-event"
		if s.invalidProvenance[source.BookmakerID] {
			sourceEventID = ""
		}
		return dto.CollectorSimulatedBetResponse{
			ActionID: command.ActionID, Result: "selected", ObservedAt: now,
			Selection: &dto.CollectorConfirmedSelection{
				FixtureID: command.FixtureID, MarketID: command.MarketID,
				OutcomeID: command.OutcomeID, OutcomeName: command.OutcomeID,
				Odds: odds, AvailableStake: 1_000_000,
				SourceEventID: sourceEventID,
				RawOdds:       rawOdds, OddsFormat: oddsFormat,
			},
		}, nil
	}
	result := s.eightResult
	if source.BookmakerID == "jun88" {
		result = s.junResult
	}
	if err := s.placeErrors[source.BookmakerID]; err != nil {
		return dto.CollectorSimulatedBetResponse{}, err
	}
	if result == "odds_changed" {
		return dto.CollectorSimulatedBetResponse{
			ActionID: command.ActionID, Result: "odds_changed", ObservedAt: now,
			SubmittedOdds: command.ExpectedOdds, OfferedOdds: -0.86,
			ConfirmationRequired: true,
		}, nil
	}
	acceptedOdds := command.ExpectedOdds
	if configured, ok := s.acceptedOdds[source.BookmakerID]; ok {
		acceptedOdds = configured
	}
	return dto.CollectorSimulatedBetResponse{
		ActionID: command.ActionID, Result: "ticket_accepted", ObservedAt: now,
		TicketID: "SIM-" + source.BookmakerID, AcceptedOdds: acceptedOdds,
		StakeVND: command.StakeVND,
	}, nil
}

func (s *collectorSimulatorStub) Commands() []recordedCommand {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]recordedCommand(nil), s.commands...)
}

func assertCommandOrder(t *testing.T, commands []recordedCommand, expected []string) {
	t.Helper()
	if len(commands) != len(expected) {
		t.Fatalf("unexpected command count: got=%+v want=%+v", commands, expected)
	}
	actual := make([]string, len(commands))
	for index, command := range commands {
		actual[index] = command.Type
		if command.Type == "simulate_place_bet" {
			actual[index] += ":" + command.Bookmaker
		}
	}
	// Selection requests are concurrent, so only their shared phase is ordered.
	for index := range expected {
		if actual[index] != expected[index] {
			t.Fatalf("unexpected command order: got=%+v want=%+v", actual, expected)
		}
	}
}

type actionStoreStub struct {
	mu    sync.Mutex
	byID  map[string]models.BetAction
	byKey map[string]string
}

func newActionStoreStub() *actionStoreStub {
	return &actionStoreStub{byID: make(map[string]models.BetAction), byKey: make(map[string]string)}
}

func (s *actionStoreStub) Create(
	_ context.Context,
	action models.BetAction,
) (models.BetAction, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if id := s.byKey[action.IdempotencyKey]; id != "" {
		return s.byID[id], false, nil
	}
	if action.Version <= 0 {
		action.Version = 1
	}
	s.byID[action.ID] = action
	s.byKey[action.IdempotencyKey] = action.ID
	return action, true, nil
}

func (s *actionStoreStub) UpdateCAS(
	_ context.Context,
	action models.BetAction,
	expectedVersion int64,
) (models.BetAction, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	current, ok := s.byID[action.ID]
	if !ok {
		return models.BetAction{}, repository.ErrNotFound
	}
	if current.Version != expectedVersion {
		return models.BetAction{}, repository.ErrVersionConflict
	}
	action.Version = expectedVersion + 1
	s.byID[action.ID] = action
	return action, nil
}

func (s *actionStoreStub) GetByID(_ context.Context, id string) (models.BetAction, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	action, ok := s.byID[id]
	if !ok {
		return models.BetAction{}, repository.ErrNotFound
	}
	return action, nil
}

func (s *actionStoreStub) List(context.Context, string, int) ([]models.BetAction, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	result := make([]models.BetAction, 0, len(s.byID))
	for _, action := range s.byID {
		result = append(result, action)
	}
	return result, nil
}
