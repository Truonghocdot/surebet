package collector

import (
	"context"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"

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
		ProtocolVersion: dto.CollectorStreamProtocolVersion,
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
		ProtocolVersion: dto.CollectorStreamProtocolVersion,
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
	upsertChanged bool
	upsertQuote   models.OddsQuote
	commitQuotes  []models.OddsQuote
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
