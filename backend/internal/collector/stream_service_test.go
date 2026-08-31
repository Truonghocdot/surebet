package collector

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"surebet/backend/internal/config"
	"surebet/backend/internal/dto"
	"surebet/backend/internal/eventbus"
	"surebet/backend/internal/models"
)

func TestStreamServiceHelloAck(t *testing.T) {
	service := NewStreamService(
		streamStoreStub{},
		&recordingEventPublisher{},
		nil,
		nil,
	)
	conn := openCollectorStreamConnection(t, service)
	defer conn.Close()

	hello := testHello("session-1")
	if err := conn.WriteJSON(hello); err != nil {
		t.Fatalf("write hello: %v", err)
	}

	var ack dto.CollectorStreamHelloAck
	if err := conn.ReadJSON(&ack); err != nil {
		t.Fatalf("read hello_ack: %v", err)
	}
	if ack.Type != "hello_ack" || ack.SessionID != hello.SessionID {
		t.Fatalf("unexpected hello ack: %+v", ack)
	}
}

func TestStreamServiceKeepsProtocolV1DuringRollout(t *testing.T) {
	service := NewStreamService(streamStoreStub{}, &recordingEventPublisher{}, nil, nil)
	conn := openCollectorStreamConnection(t, service)
	defer conn.Close()
	hello := testHello("session-v1")
	hello.ProtocolVersion = 1
	if err := conn.WriteJSON(hello); err != nil {
		t.Fatalf("write v1 hello: %v", err)
	}
	var ack dto.CollectorStreamHelloAck
	if err := conn.ReadJSON(&ack); err != nil {
		t.Fatalf("read v1 hello ack: %v", err)
	}
	if ack.ProtocolVersion != 1 {
		t.Fatalf("expected negotiated v1 ack, got %+v", ack)
	}
}

func TestStreamServiceRejectsUnauthenticatedProtocolV4(t *testing.T) {
	service := NewStreamService(streamStoreStub{}, &recordingEventPublisher{}, nil, nil)
	conn := openCollectorStreamConnection(t, service)
	defer conn.Close()

	hello := testHello("session-live-unauthenticated")
	hello.ProtocolVersion = 4
	hello.AccountID = "account-1"
	hello.Capabilities = []string{CapabilityBetPrepare}
	if err := conn.WriteJSON(hello); err != nil {
		t.Fatalf("write live hello: %v", err)
	}
	var response dto.CollectorStreamError
	if err := conn.ReadJSON(&response); err != nil {
		t.Fatalf("read live auth error: %v", err)
	}
	if response.Code != "live_auth_required" {
		t.Fatalf("expected live_auth_required, got %+v", response)
	}
}

func TestStreamServiceAuthenticatesAndCorrelatesLivePrepare(t *testing.T) {
	service := NewStreamService(streamStoreStub{}, &recordingEventPublisher{}, nil, nil)
	service.SetCollectorStreamAuth(config.CollectorStreamAuthConfig{
		Required: true,
		Credentials: []config.CollectorStreamCredential{{
			CollectorID: "jun88-cmd", BookmakerID: "jun88", LobbyID: "cmd",
			AccountID: "account-1", Token: "collector-secret",
		}},
	})

	server := httptest.NewServer(service)
	defer server.Close()
	url := "ws" + strings.TrimPrefix(server.URL, "http") +
		"?collector_id=jun88-cmd&bookmaker_id=jun88&lobby_id=cmd&account_id=account-1&access_token=collector-secret"
	conn, response, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		if response != nil {
			t.Fatalf("dial authenticated collector stream: %v status=%d", err, response.StatusCode)
		}
		t.Fatalf("dial authenticated collector stream: %v", err)
	}
	defer conn.Close()

	hello := testHello("session-live")
	hello.ProtocolVersion = 4
	hello.AccountID = "account-1"
	hello.Capabilities = []string{CapabilityBetPrepare, CapabilityBetCommit, CapabilityBetReconcile}
	if err := conn.WriteJSON(hello); err != nil {
		t.Fatalf("write live hello: %v", err)
	}
	var ack dto.CollectorStreamHelloAck
	if err := conn.ReadJSON(&ack); err != nil {
		t.Fatalf("read live hello ack: %v", err)
	}
	if ack.ProtocolVersion != 4 || ack.AccountID != "account-1" {
		t.Fatalf("unexpected live hello ack: %+v", ack)
	}

	type result struct {
		response dto.CollectorLiveBetResponse
		sent     bool
		err      error
	}
	resultCh := make(chan result, 1)
	go func() {
		liveResponse, sent, executeErr := service.ExecuteLiveBet(
			context.Background(),
			hello.Source,
			dto.CollectorLiveBetRequest{
				Type: "prepare_bet", ActionID: "action-1", AttemptID: "attempt-1",
				OpportunityID: "opportunity-1", LegID: "leg-jun88", AccountID: "account-1",
				FixtureID: "fixture-1", MarketID: "market-1", OutcomeID: "outcome-1",
				ProviderRef: "25212060_Hdp_Home", ExpectedOdds: -0.92, OddsFormat: "malay",
				ExpiresAt: time.Now().UTC().Add(time.Minute),
			},
		)
		resultCh <- result{response: liveResponse, sent: sent, err: executeErr}
	}()

	var request dto.CollectorLiveBetRequest
	if err := conn.ReadJSON(&request); err != nil {
		t.Fatalf("read live prepare: %v", err)
	}
	if request.Type != "prepare_bet" || request.ProtocolVersion != 4 ||
		request.SessionID != hello.SessionID || request.Source != hello.Source {
		t.Fatalf("unexpected live prepare: %+v", request)
	}
	if err := conn.WriteJSON(dto.CollectorLiveBetResponse{
		Type: "bet_prepared", ProtocolVersion: 4, SessionID: hello.SessionID, Seq: 1,
		RequestID: request.RequestID, ActionID: request.ActionID, AttemptID: request.AttemptID,
		OpportunityID: request.OpportunityID, LegID: request.LegID, AccountID: request.AccountID,
		Source: hello.Source, Result: "prepared", ObservedAt: time.Now().UTC(),
		PrepareID: "prepare-1", SlipFingerprint: "fingerprint-1", DisplayedOdds: -0.92,
		RawOdds: -0.92, OddsFormat: "malay", MinimumStakeVND: 20_000,
		MaximumStakeVND: 500_000, StakeIncrementVND: 1_000, BalanceVND: 1_000_000,
		SessionGeneration: "generation-1",
	}); err != nil {
		t.Fatalf("write live prepare response: %v", err)
	}

	select {
	case got := <-resultCh:
		if got.err != nil || !got.sent || got.response.Result != "prepared" || got.response.PrepareID != "prepare-1" {
			t.Fatalf("unexpected live prepare result: %+v", got)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for live prepare result")
	}
}

func TestStreamServiceRejectsInvalidCollectorCredentialBeforeUpgrade(t *testing.T) {
	service := NewStreamService(streamStoreStub{}, &recordingEventPublisher{}, nil, nil)
	service.SetCollectorStreamAuth(config.CollectorStreamAuthConfig{
		Required: true,
		Credentials: []config.CollectorStreamCredential{{
			CollectorID: "jun88-cmd", BookmakerID: "jun88", LobbyID: "cmd",
			AccountID: "account-1", Token: "collector-secret",
		}},
	})
	request := httptest.NewRequest(http.MethodGet,
		"http://example.test?collector_id=jun88-cmd&bookmaker_id=jun88&lobby_id=cmd&account_id=account-1&access_token=wrong",
		nil,
	)
	response := httptest.NewRecorder()
	service.ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expected unauthorized before upgrade, got %d", response.Code)
	}
}

func TestStreamServicePublishesCommittedFixtureSnapshot(t *testing.T) {
	publisher := &recordingEventPublisher{}
	service := NewStreamService(
		streamStoreStub{fixtureMarketQuotes: []models.OddsQuote{{
			BookmakerID:     "jun88",
			LobbyID:         "cmd",
			FixtureID:       "fixture-v2",
			MarketID:        "hdp-ah",
			OutcomeID:       "home",
			ProtocolVersion: 2,
			BatchID:         "batch-1",
		}}},
		publisher,
		nil,
		nil,
	)
	service.SetStateProtocol("v2")
	conn := openCollectorStreamConnection(t, service)
	defer conn.Close()
	hello := testHello("session-v2")
	if err := conn.WriteJSON(hello); err != nil {
		t.Fatalf("write hello: %v", err)
	}
	if _, _, err := conn.ReadMessage(); err != nil {
		t.Fatalf("read hello ack: %v", err)
	}

	if err := conn.WriteJSON(dto.CollectorStreamFixtureMarketSnapshot{
		Type:            "fixture_market_snapshot",
		ProtocolVersion: 2,
		SessionID:       hello.SessionID,
		Seq:             1,
		BatchID:         "batch-1",
		Fingerprint:     "fingerprint-1",
		ObservedAt:      time.Now().UTC(),
		Source:          hello.Source,
		Fixture:         dto.CollectorStreamFixture{FixtureID: "fixture-v2"},
		Complete:        true,
	}); err != nil {
		t.Fatalf("write fixture snapshot: %v", err)
	}

	deadline := time.Now().Add(time.Second)
	for publisher.count() == 0 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	event := publisher.latest()
	if event.Type != eventbus.EventFixtureOddsSnapshot || len(event.Payload.Quotes) != 1 {
		t.Fatalf("expected full fixture snapshot event, got %+v", event)
	}
}

func TestStreamServiceRejectsStaleSession(t *testing.T) {
	service := NewStreamService(
		streamStoreStub{},
		&recordingEventPublisher{},
		nil,
		nil,
	)

	first := openCollectorStreamConnection(t, service)
	defer first.Close()
	second := openCollectorStreamConnection(t, service)
	defer second.Close()

	if err := first.WriteJSON(testHello("session-old")); err != nil {
		t.Fatalf("write first hello: %v", err)
	}
	if _, _, err := first.ReadMessage(); err != nil {
		t.Fatalf("read first hello_ack: %v", err)
	}
	if err := second.WriteJSON(testHello("session-new")); err != nil {
		t.Fatalf("write second hello: %v", err)
	}
	if _, _, err := second.ReadMessage(); err != nil {
		t.Fatalf("read second hello_ack: %v", err)
	}

	if err := first.WriteJSON(dto.CollectorStreamHeartbeat{
		Type:      "heartbeat",
		SessionID: "session-old",
		Seq:       1,
		SentAt:    time.Now().UTC(),
	}); err != nil {
		t.Fatalf("write stale heartbeat: %v", err)
	}

	var streamError dto.CollectorStreamError
	if err := first.ReadJSON(&streamError); err != nil {
		t.Fatalf("read stale session error: %v", err)
	}
	if streamError.Code != "stale_session" {
		t.Fatalf("expected stale_session error, got %+v", streamError)
	}
}

func TestStreamServiceConfirmsQuoteThroughActiveCollector(t *testing.T) {
	service := NewStreamService(streamStoreStub{}, &recordingEventPublisher{}, nil, nil)
	conn := openCollectorStreamConnection(t, service)
	defer conn.Close()

	hello := testHello("session-confirm")
	if err := conn.WriteJSON(hello); err != nil {
		t.Fatalf("write hello: %v", err)
	}
	if _, _, err := conn.ReadMessage(); err != nil {
		t.Fatalf("read hello_ack: %v", err)
	}

	type confirmationResult struct {
		response dto.CollectorConfirmQuoteResponse
		err      error
	}
	resultChannel := make(chan confirmationResult, 1)
	go func() {
		response, err := service.ConfirmQuote(
			context.Background(),
			hello.Source,
			"fixture-a",
			"hdp-ah",
			"home-plus-0.5",
		)
		resultChannel <- confirmationResult{response: response, err: err}
	}()

	var request dto.CollectorConfirmQuoteRequest
	if err := conn.ReadJSON(&request); err != nil {
		t.Fatalf("read confirmation request: %v", err)
	}
	if request.Type != "confirm_quote" || request.SessionID != hello.SessionID ||
		request.FixtureID != "fixture-a" || request.MarketID != "hdp-ah" ||
		request.OutcomeID != "home-plus-0.5" {
		t.Fatalf("unexpected confirmation request: %+v", request)
	}

	observedAt := time.Now().UTC()
	if err := conn.WriteJSON(dto.CollectorConfirmQuoteResponse{
		Type:       "confirm_quote_response",
		SessionID:  hello.SessionID,
		Seq:        1,
		RequestID:  request.RequestID,
		ObservedAt: observedAt,
		Found:      true,
		Selection: &dto.CollectorConfirmedSelection{
			FixtureID:   request.FixtureID,
			MarketID:    request.MarketID,
			OutcomeID:   request.OutcomeID,
			OutcomeName: "Team A +0.5",
			Odds:        -0.92,
		},
	}); err != nil {
		t.Fatalf("write confirmation response: %v", err)
	}

	select {
	case result := <-resultChannel:
		if result.err != nil {
			t.Fatalf("confirm quote: %v", result.err)
		}
		if !result.response.Found || result.response.RequestID != request.RequestID ||
			result.response.Selection == nil || result.response.Selection.Odds != -0.92 {
			t.Fatalf("unexpected confirmation response: %+v", result.response)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for quote confirmation")
	}
}

func TestStreamServiceCorrelatesSimulationOnlyPlacement(t *testing.T) {
	service := NewStreamService(streamStoreStub{}, &recordingEventPublisher{}, nil, nil)
	conn := openCollectorStreamConnection(t, service)
	defer conn.Close()

	hello := testHello("session-simulation")
	if err := conn.WriteJSON(hello); err != nil {
		t.Fatalf("write hello: %v", err)
	}
	if _, _, err := conn.ReadMessage(); err != nil {
		t.Fatalf("read hello_ack: %v", err)
	}

	type simulationResult struct {
		response dto.CollectorSimulatedBetResponse
		err      error
	}
	resultChannel := make(chan simulationResult, 1)
	go func() {
		response, err := service.SimulateBet(
			context.Background(),
			hello.Source,
			dto.CollectorSimulatedBetRequest{
				Type: "simulate_place_bet", ActionID: "action-1", OpportunityID: "opportunity-1",
				LegID: "jun88-leg", Sequence: 1, FixtureID: "fixture-a", MarketID: "hdp-ah",
				OutcomeID: "home-plus-0.5", ExpectedOdds: -0.92, StakeVND: 50_000,
				ExpiresAt: time.Now().UTC().Add(time.Minute), TimeoutMS: 2_000,
				IdempotencyKey: "action-1:jun88:place",
			},
		)
		resultChannel <- simulationResult{response: response, err: err}
	}()

	var request dto.CollectorSimulatedBetRequest
	if err := conn.ReadJSON(&request); err != nil {
		t.Fatalf("read simulated placement: %v", err)
	}
	if request.Type != "simulate_place_bet" || request.ActionID != "action-1" ||
		request.IdempotencyKey != "action-1:jun88:place" || request.Sequence != 1 {
		t.Fatalf("unexpected simulated placement request: %+v", request)
	}

	if err := conn.WriteJSON(dto.CollectorSimulatedBetResponse{
		Type: "simulate_place_bet_response", SessionID: hello.SessionID, Seq: 1,
		RequestID: request.RequestID, ActionID: request.ActionID,
		OpportunityID: request.OpportunityID, LegID: request.LegID, Sequence: request.Sequence,
		IdempotencyKey: request.IdempotencyKey, Result: "ticket_accepted",
		ObservedAt: time.Now().UTC(), TicketID: "SIM-J88-1", AcceptedOdds: -0.92, StakeVND: 50_000,
	}); err != nil {
		t.Fatalf("write simulated placement response: %v", err)
	}

	select {
	case result := <-resultChannel:
		if result.err != nil || result.response.TicketID != "SIM-J88-1" {
			t.Fatalf("unexpected simulated placement result: response=%+v err=%v", result.response, result.err)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for simulated placement")
	}
}

func TestStreamServiceRejectsSimulationForLegacyCollectorProtocol(t *testing.T) {
	service := NewStreamService(streamStoreStub{}, &recordingEventPublisher{}, nil, nil)
	conn := openCollectorStreamConnection(t, service)
	defer conn.Close()

	hello := testHello("session-legacy-simulation")
	hello.ProtocolVersion = 2
	if err := conn.WriteJSON(hello); err != nil {
		t.Fatalf("write hello: %v", err)
	}
	if _, _, err := conn.ReadMessage(); err != nil {
		t.Fatalf("read hello_ack: %v", err)
	}

	_, err := service.SimulateBet(context.Background(), hello.Source, dto.CollectorSimulatedBetRequest{
		Type: "simulate_select_odds", ActionID: "action-1", OpportunityID: "opportunity-1",
		LegID: "leg-1", Sequence: 1, FixtureID: "fixture-a", MarketID: "hdp-ah",
		OutcomeID: "home-plus-0.5", ExpectedOdds: -0.92, StakeVND: 50_000,
		ExpiresAt: time.Now().UTC().Add(time.Minute), TimeoutMS: 2_000,
	})
	if err == nil || !strings.Contains(err.Error(), "protocol v3") {
		t.Fatalf("expected a simulation protocol error, got %v", err)
	}
}

func TestStreamServiceRejectsMismatchedSimulationResponseIdentity(t *testing.T) {
	service := NewStreamService(streamStoreStub{}, &recordingEventPublisher{}, nil, nil)
	responses := make(chan dto.CollectorSimulatedBetResponse, 1)
	source := dto.CollectorSource{CollectorID: "jun88-cmd", BookmakerID: "jun88", LobbyID: "cmd"}
	service.simulations["request-1"] = pendingSimulationRequest{
		responses: responses, source: source, sessionID: "session-1",
		responseType: "simulate_place_bet_response", actionID: "action-1",
		opportunityID: "opportunity-1", legID: "leg-1", sequence: 1,
		idempotencyKey: "action-1:jun88:place",
	}
	service.deliverSimulatedBetResponse(source, dto.CollectorSimulatedBetResponse{
		Type: "simulate_place_bet_response", SessionID: "session-1", RequestID: "request-1",
		ActionID: "action-1", OpportunityID: "opportunity-1", LegID: "wrong-leg",
		Sequence: 1, IdempotencyKey: "action-1:jun88:place", Result: "ticket_accepted",
	})
	response := <-responses
	if response.Result != "failed" || !strings.Contains(response.Error, "correlation mismatch") {
		t.Fatalf("mismatched response was not rejected: %+v", response)
	}
}

func TestStreamServicePublishesBufferedSnapshotOnceOnCommit(t *testing.T) {
	publisher := &recordingEventPublisher{}
	service := NewStreamService(
		streamStoreStub{
			upsertChanged: true,
			upsertQuote: models.OddsQuote{
				ID:          "quote-a",
				BookmakerID: "jun88",
				LobbyID:     "cmd",
				FixtureID:   "fixture-a",
				MarketID:    "market-a",
				OutcomeID:   "outcome-a",
				CollectedAt: time.Date(2026, 7, 16, 10, 0, 0, 0, time.UTC),
			},
		},
		publisher,
		nil,
		nil,
	)

	conn := openCollectorStreamConnection(t, service)
	defer conn.Close()

	hello := testHello("session-1")
	if err := conn.WriteJSON(hello); err != nil {
		t.Fatalf("write hello: %v", err)
	}
	if _, _, err := conn.ReadMessage(); err != nil {
		t.Fatalf("read hello_ack: %v", err)
	}

	if err := conn.WriteJSON(dto.CollectorStreamSnapshotBegin{
		Type:       "snapshot_begin",
		SessionID:  hello.SessionID,
		SnapshotID: "snapshot-1",
		Seq:        1,
		SentAt:     time.Now().UTC(),
	}); err != nil {
		t.Fatalf("write snapshot_begin: %v", err)
	}
	if err := conn.WriteJSON(dto.CollectorStreamQuoteUpsert{
		Type:       "quote_upsert",
		SessionID:  hello.SessionID,
		SnapshotID: "snapshot-1",
		Seq:        2,
		OccurredAt: time.Now().UTC(),
		Source:     hello.Source,
		RawIDs: dto.CollectorStreamRawIDs{
			FixtureID: "fixture-a",
			MarketID:  "market-a",
			OutcomeID: "outcome-a",
		},
		Markers: dto.CollectorStreamMarkers{
			FixtureMarker: "fixture-a-marker",
			MarketMarker:  "handicap",
			OutcomeMarker: "outcome-a-marker",
		},
		Quote: dto.CollectorStreamQuote{
			Sport:          "football",
			HomeTeam:       "A",
			AwayTeam:       "B",
			LeagueName:     "League",
			MatchState:     "live",
			EventStartAt:   time.Now().UTC().Format(time.RFC3339),
			OutcomeName:    "Outcome A",
			Odds:           0.95,
			AvailableStake: 100,
			Suspended:      false,
		},
	}); err != nil {
		t.Fatalf("write quote_upsert: %v", err)
	}
	if err := conn.WriteJSON(dto.CollectorStreamSnapshotCommit{
		Type:          "snapshot_commit",
		SessionID:     hello.SessionID,
		SnapshotID:    "snapshot-1",
		Seq:           3,
		SentAt:        time.Now().UTC(),
		ExpectedCount: 1,
	}); err != nil {
		t.Fatalf("write snapshot_commit: %v", err)
	}

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if publisher.count() == 1 {
			return
		}
		time.Sleep(25 * time.Millisecond)
	}

	t.Fatalf("expected one aggregated publish after snapshot_commit, got %d", publisher.count())
}

func TestStreamServiceCoalescesDirectQuotePublishes(t *testing.T) {
	publisher := &recordingEventPublisher{}
	service := NewStreamService(
		streamStoreStub{
			upsertChanged: true,
			upsertQuote: models.OddsQuote{
				ID:          "quote-a",
				BookmakerID: "8xbet",
				LobbyID:     "default",
				FixtureID:   "fixture-a",
				MarketID:    "market-a",
				OutcomeID:   "outcome-a",
				CollectedAt: time.Date(2026, 7, 16, 10, 0, 0, 0, time.UTC),
			},
		},
		publisher,
		nil,
		nil,
	)
	service.debounce = 20 * time.Millisecond

	conn := openCollectorStreamConnection(t, service)
	defer conn.Close()

	hello := dto.CollectorStreamHello{
		Type:            "hello",
		ProtocolVersion: 3,
		SessionID:       "session-1",
		Source: dto.CollectorSource{
			CollectorID: "8xbet",
			BookmakerID: "8xbet",
			LobbyID:     "default",
		},
		StartedAt: time.Now().UTC(),
	}
	if err := conn.WriteJSON(hello); err != nil {
		t.Fatalf("write hello: %v", err)
	}
	if _, _, err := conn.ReadMessage(); err != nil {
		t.Fatalf("read hello_ack: %v", err)
	}

	writeUpsert := func(seq int64, outcomeID string) {
		t.Helper()
		err := conn.WriteJSON(dto.CollectorStreamQuoteUpsert{
			Type:       "quote_upsert",
			SessionID:  hello.SessionID,
			Seq:        seq,
			OccurredAt: time.Now().UTC(),
			Source:     hello.Source,
			RawIDs: dto.CollectorStreamRawIDs{
				FixtureID: "fixture-a",
				MarketID:  "market-a",
				OutcomeID: outcomeID,
			},
			Markers: dto.CollectorStreamMarkers{
				FixtureMarker: "fixture-a-marker",
				MarketMarker:  "handicap",
				OutcomeMarker: outcomeID + "-marker",
			},
			Quote: dto.CollectorStreamQuote{
				Sport:          "football",
				HomeTeam:       "A",
				AwayTeam:       "B",
				LeagueName:     "League",
				MatchState:     "live",
				EventStartAt:   time.Now().UTC().Format(time.RFC3339),
				OutcomeName:    "Outcome " + outcomeID,
				Odds:           0.95,
				AvailableStake: 100,
				Suspended:      false,
			},
		})
		if err != nil {
			t.Fatalf("write quote_upsert: %v", err)
		}
	}

	writeUpsert(1, "outcome-a")
	writeUpsert(2, "outcome-b")

	deadline := time.Now().Add(1 * time.Second)
	for time.Now().Before(deadline) {
		if publisher.count() == 1 {
			event := publisher.latest()
			if len(event.Payload.Quotes) != 1 {
				t.Fatalf("expected coalesced direct publish to dedupe by quote id in this stub, got %+v", event.Payload.Quotes)
			}
			return
		}
		time.Sleep(10 * time.Millisecond)
	}

	t.Fatalf("expected one coalesced publish, got %d", publisher.count())
}

func openCollectorStreamConnection(t *testing.T, service *StreamService) *websocket.Conn {
	t.Helper()

	server := httptest.NewServer(service)
	t.Cleanup(server.Close)

	url := "ws" + strings.TrimPrefix(server.URL, "http")
	conn, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		t.Fatalf("dial collector stream: %v", err)
	}
	return conn
}

func testHello(sessionID string) dto.CollectorStreamHello {
	return dto.CollectorStreamHello{
		Type:            "hello",
		ProtocolVersion: 3,
		SessionID:       sessionID,
		Source: dto.CollectorSource{
			CollectorID: "jun88-cmd",
			BookmakerID: "jun88",
			LobbyID:     "cmd",
		},
		StartedAt: time.Now().UTC(),
	}
}

type streamStoreStub struct {
	upsertChanged       bool
	upsertQuote         models.OddsQuote
	commitQuotes        []models.OddsQuote
	fixtureMarketQuotes []models.OddsQuote
}

func (s streamStoreStub) ObserveSource(context.Context, dto.CollectorSource, time.Time) error {
	return nil
}

func (s streamStoreStub) BeginSnapshot(context.Context, dto.CollectorSource, string, string) error {
	return nil
}

func (s streamStoreStub) ApplyQuoteUpsert(context.Context, dto.CollectorStreamQuoteUpsert) (bool, models.OddsQuote, error) {
	return s.upsertChanged, s.upsertQuote, nil
}

func (s streamStoreStub) ApplyQuoteUpsertBatch(context.Context, []dto.CollectorStreamQuoteUpsert) ([]models.OddsQuote, error) {
	if !s.upsertChanged {
		return nil, nil
	}
	return []models.OddsQuote{s.upsertQuote}, nil
}

func (s streamStoreStub) ApplyQuoteRemove(context.Context, dto.CollectorStreamQuoteRemove) (bool, models.OddsQuote, error) {
	return false, models.OddsQuote{}, nil
}

func (s streamStoreStub) ApplyFixtureMarketSnapshot(context.Context, dto.CollectorStreamFixtureMarketSnapshot) ([]models.OddsQuote, error) {
	return append([]models.OddsQuote(nil), s.fixtureMarketQuotes...), nil
}

func (s streamStoreStub) ObserveFixtureBatches(context.Context, dto.CollectorStreamFixtureObservedBatch) error {
	return nil
}

func (s streamStoreStub) CommitSnapshot(context.Context, dto.CollectorSource, string, dto.CollectorStreamSnapshotCommit) ([]models.OddsQuote, error) {
	return append([]models.OddsQuote(nil), s.commitQuotes...), nil
}

type recordingEventPublisher struct {
	mu     sync.Mutex
	events []eventbus.OddsUpdatedEvent
}

func (p *recordingEventPublisher) PublishOddsUpdated(_ context.Context, event eventbus.OddsUpdatedEvent) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.events = append(p.events, event)
	return nil
}

func (p *recordingEventPublisher) count() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return len(p.events)
}

func (p *recordingEventPublisher) latest() eventbus.OddsUpdatedEvent {
	p.mu.Lock()
	defer p.mu.Unlock()
	if len(p.events) == 0 {
		return eventbus.OddsUpdatedEvent{}
	}
	return p.events[len(p.events)-1]
}
