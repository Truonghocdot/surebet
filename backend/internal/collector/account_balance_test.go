package collector

import (
	"context"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"surebet/backend/internal/config"
	"surebet/backend/internal/dto"
	"surebet/backend/internal/realtime"
)

func TestStreamServiceAcceptsAuthenticatedAccountBalanceAndPublishesRealtime(t *testing.T) {
	broadcaster := &accountBalanceBroadcasterStub{}
	service := NewStreamService(streamStoreStub{}, &recordingEventPublisher{}, nil, nil)
	service.SetAccountBalanceBroadcaster(broadcaster)
	conn, hello := openAuthenticatedBalanceStream(t, service, 4, true)
	defer conn.Close()

	amountVND := 1_234_500.0
	if err := conn.WriteJSON(dto.CollectorStreamAccountBalance{
		Type: "account_balance", ProtocolVersion: 4, SessionID: hello.SessionID, Seq: 1,
		ObservedAt: time.Now().UTC(), Source: hello.Source, AccountID: hello.AccountID,
		Balance: dto.CollectorAccountBalanceValue{
			Amount: 1234.5, Currency: "vd", AmountVND: &amountVND, DisplayText: "  VD 1,234.50  ",
		},
	}); err != nil {
		t.Fatalf("write account balance: %v", err)
	}

	var result dto.CollectorAccountBalanceListView
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		var err error
		result, err = service.ListAccountBalances(context.Background())
		if err != nil {
			t.Fatalf("list account balances: %v", err)
		}
		if len(result.Items) == 1 && broadcaster.count() == 1 {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	if len(result.Items) != 1 {
		t.Fatalf("expected one account balance, got %+v", result)
	}
	item := result.Items[0]
	if item.AccountID != "account-1" || item.Source != hello.Source ||
		item.Balance.Amount != 1234.5 || item.Balance.Currency != "VD" ||
		item.Balance.AmountVND == nil || *item.Balance.AmountVND != amountVND ||
		item.Balance.DisplayText != "VD 1,234.50" || item.Stale ||
		item.ObservedAt.IsZero() || item.ReceivedAt.IsZero() || result.StaleAfterSeconds != 45 {
		t.Fatalf("unexpected account balance view: %+v", result)
	}
	event := broadcaster.latest()
	if event.Type != accountBalanceEventType {
		t.Fatalf("unexpected realtime event: %+v", event)
	}
	payload, ok := event.Payload.(dto.CollectorAccountBalanceView)
	if !ok || payload.AccountID != item.AccountID || payload.Balance.Currency != "VD" {
		t.Fatalf("unexpected realtime payload: %#v", event.Payload)
	}

	service.balanceMu.Lock()
	stored := service.accountBalances[accountBalanceKey(hello.Source, hello.AccountID)]
	stored.ReceivedAt = time.Now().UTC().Add(-46 * time.Second)
	service.accountBalances[accountBalanceKey(hello.Source, hello.AccountID)] = stored
	service.balanceMu.Unlock()
	stale, err := service.ListAccountBalances(context.Background())
	if err != nil || len(stale.Items) != 1 || !stale.Items[0].Stale {
		t.Fatalf("expected stale account balance, got view=%+v err=%v", stale, err)
	}
}

func TestStreamServiceRejectsAccountBalanceIdentityAndInvalidValue(t *testing.T) {
	service := NewStreamService(streamStoreStub{}, &recordingEventPublisher{}, nil, nil)
	conn, hello := openAuthenticatedBalanceStream(t, service, 4, true)
	defer conn.Close()

	base := dto.CollectorStreamAccountBalance{
		Type: "account_balance", ProtocolVersion: 4, SessionID: hello.SessionID, Seq: 1,
		ObservedAt: time.Now().UTC(), Source: hello.Source, AccountID: "other-account",
		Balance: dto.CollectorAccountBalanceValue{Amount: 100, Currency: "VND"},
	}
	if err := conn.WriteJSON(base); err != nil {
		t.Fatalf("write mismatched balance: %v", err)
	}
	var streamError dto.CollectorStreamError
	if err := conn.ReadJSON(&streamError); err != nil {
		t.Fatalf("read account mismatch: %v", err)
	}
	if streamError.Code != "account_mismatch" {
		t.Fatalf("expected account_mismatch, got %+v", streamError)
	}

	base.AccountID = hello.AccountID
	base.Seq = 2
	base.Balance.Amount = -1
	if err := conn.WriteJSON(base); err != nil {
		t.Fatalf("write invalid balance: %v", err)
	}
	if err := conn.ReadJSON(&streamError); err != nil {
		t.Fatalf("read invalid balance: %v", err)
	}
	if streamError.Code != "invalid_account_balance" {
		t.Fatalf("expected invalid_account_balance, got %+v", streamError)
	}
	result, err := service.ListAccountBalances(context.Background())
	if err != nil || len(result.Items) != 0 {
		t.Fatalf("rejected balance reached registry: view=%+v err=%v", result, err)
	}
}

func TestStreamServiceRejectsAccountBalanceBelowProtocolV4(t *testing.T) {
	service := NewStreamService(streamStoreStub{}, &recordingEventPublisher{}, nil, nil)
	conn, hello := openAuthenticatedBalanceStream(t, service, 3, false)
	defer conn.Close()

	if err := conn.WriteJSON(dto.CollectorStreamAccountBalance{
		Type: "account_balance", ProtocolVersion: 4, SessionID: hello.SessionID, Seq: 1,
		ObservedAt: time.Now().UTC(), Source: hello.Source, AccountID: hello.AccountID,
		Balance: dto.CollectorAccountBalanceValue{Amount: 100, Currency: "VND"},
	}); err != nil {
		t.Fatalf("write protocol-mismatched balance: %v", err)
	}
	var streamError dto.CollectorStreamError
	if err := conn.ReadJSON(&streamError); err != nil {
		t.Fatalf("read protocol mismatch: %v", err)
	}
	if streamError.Code != "protocol_mismatch" {
		t.Fatalf("expected protocol_mismatch, got %+v", streamError)
	}
}

func TestStreamServiceRequiresAccountBalanceCapability(t *testing.T) {
	service := NewStreamService(streamStoreStub{}, &recordingEventPublisher{}, nil, nil)
	conn, hello := openAuthenticatedBalanceStream(t, service, 4, false)
	defer conn.Close()

	if err := conn.WriteJSON(dto.CollectorStreamAccountBalance{
		Type: "account_balance", ProtocolVersion: 4, SessionID: hello.SessionID, Seq: 1,
		ObservedAt: time.Now().UTC(), Source: hello.Source, AccountID: hello.AccountID,
		Balance: dto.CollectorAccountBalanceValue{Amount: 100, Currency: "VND"},
	}); err != nil {
		t.Fatalf("write account balance without capability: %v", err)
	}
	var streamError dto.CollectorStreamError
	if err := conn.ReadJSON(&streamError); err != nil {
		t.Fatalf("read capability error: %v", err)
	}
	if streamError.Code != "capability_required" {
		t.Fatalf("expected capability_required, got %+v", streamError)
	}
}

func openAuthenticatedBalanceStream(
	t *testing.T,
	service *StreamService,
	protocolVersion int,
	advertiseBalance bool,
) (*websocket.Conn, dto.CollectorStreamHello) {
	t.Helper()
	service.SetCollectorStreamAuth(config.CollectorStreamAuthConfig{
		Required: true,
		Credentials: []config.CollectorStreamCredential{{
			CollectorID: "jun88-cmd", BookmakerID: "jun88", LobbyID: "cmd",
			AccountID: "account-1", Token: "collector-secret",
		}},
	})
	server := httptest.NewServer(service)
	t.Cleanup(server.Close)
	url := "ws" + strings.TrimPrefix(server.URL, "http") +
		"?collector_id=jun88-cmd&bookmaker_id=jun88&lobby_id=cmd&account_id=account-1&access_token=collector-secret"
	conn, response, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		if response != nil {
			t.Fatalf("dial authenticated account balance stream: %v status=%d", err, response.StatusCode)
		}
		t.Fatalf("dial authenticated account balance stream: %v", err)
	}

	hello := testHello("session-balance")
	hello.ProtocolVersion = protocolVersion
	hello.AccountID = "account-1"
	if advertiseBalance {
		hello.Capabilities = []string{CapabilityAccountBalance}
	}
	if err := conn.WriteJSON(hello); err != nil {
		conn.Close()
		t.Fatalf("write account balance hello: %v", err)
	}
	var ack dto.CollectorStreamHelloAck
	if err := conn.ReadJSON(&ack); err != nil {
		conn.Close()
		t.Fatalf("read account balance hello ack: %v", err)
	}
	return conn, hello
}

type accountBalanceBroadcasterStub struct {
	mu     sync.Mutex
	events []realtime.Event
}

func (s *accountBalanceBroadcasterStub) Broadcast(event realtime.Event) {
	s.mu.Lock()
	s.events = append(s.events, event)
	s.mu.Unlock()
}

func (s *accountBalanceBroadcasterStub) count() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.events)
}

func (s *accountBalanceBroadcasterStub) latest() realtime.Event {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.events) == 0 {
		return realtime.Event{}
	}
	return s.events[len(s.events)-1]
}
