package collector

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"surebet/backend/internal/dto"
	"surebet/backend/internal/logger"
	"surebet/backend/internal/models"
	"surebet/backend/internal/repository"
)

type StreamOddsStateStore interface {
	BeginSnapshot(ctx context.Context, source dto.CollectorSource, sessionID, snapshotID string) error
	ApplyQuoteUpsert(ctx context.Context, event dto.CollectorStreamQuoteUpsert) (bool, models.OddsQuote, error)
	ApplyQuoteRemove(ctx context.Context, event dto.CollectorStreamQuoteRemove) (bool, models.OddsQuote, error)
	CommitSnapshot(
		ctx context.Context,
		source dto.CollectorSource,
		sessionID string,
		event dto.CollectorStreamSnapshotCommit,
	) ([]models.OddsQuote, error)
}

type StreamService struct {
	store     StreamOddsStateStore
	publisher EventPublisher
	notifier  SurebetNotifier
	log       logger.Logger
	upgrader  websocket.Upgrader
	sessions  collectorSessionRegistry
}

func NewStreamService(
	store StreamOddsStateStore,
	publisher EventPublisher,
	notifier SurebetNotifier,
	log logger.Logger,
) *StreamService {
	return &StreamService{
		store:     store,
		publisher: publisher,
		notifier:  notifier,
		log:       log,
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool {
				return true
			},
		},
		sessions: collectorSessionRegistry{
			active: make(map[string]string),
		},
	}
}

func (s *StreamService) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		if s.log != nil {
			s.log.Warn("collector stream upgrade failed", "error", err.Error())
		}
		return
	}
	defer conn.Close()

	state := collectorStreamConnectionState{
		pendingSnapshots: make(map[string][]models.OddsQuote),
	}
	defer func() {
		if state.hello != nil {
			s.sessions.Unregister(state.hello.Source, state.hello.SessionID)
		}
	}()

	for {
		_, payload, err := conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) && s.log != nil {
				s.log.Warn("collector stream connection closed unexpectedly", "error", err.Error())
			}
			return
		}

		if err := s.handleMessage(r.Context(), conn, &state, payload); err != nil {
			_ = s.writeFrame(conn, dto.CollectorStreamError{
				Type:      "error",
				SessionID: state.sessionID(),
				Code:      "internal_error",
				Message:   err.Error(),
			})
			return
		}
	}
}

func (s *StreamService) handleMessage(
	ctx context.Context,
	conn *websocket.Conn,
	state *collectorStreamConnectionState,
	payload []byte,
) error {
	var frame dto.CollectorStreamFrame
	if err := json.Unmarshal(payload, &frame); err != nil {
		return s.writeFrame(conn, dto.CollectorStreamError{
			Type:    "error",
			Code:    "invalid_json",
			Message: "collector stream frame is not valid JSON",
		})
	}

	switch frame.Type {
	case "hello":
		var hello dto.CollectorStreamHello
		if err := json.Unmarshal(payload, &hello); err != nil {
			return s.writeFrame(conn, dto.CollectorStreamError{
				Type:    "error",
				Code:    "invalid_hello",
				Message: "collector hello frame is invalid",
			})
		}
		return s.handleHello(conn, state, hello)
	case "snapshot_begin":
		var event dto.CollectorStreamSnapshotBegin
		if err := json.Unmarshal(payload, &event); err != nil {
			return s.writeFrame(conn, dto.CollectorStreamError{
				Type:      "error",
				SessionID: state.sessionID(),
				Code:      "invalid_snapshot_begin",
				Message:   "snapshot_begin frame is invalid",
			})
		}
		if err := s.requireActiveSession(conn, state, event.SessionID); err != nil {
			return err
		}
		state.pendingSnapshots[event.SnapshotID] = nil
		return s.store.BeginSnapshot(ctx, state.hello.Source, event.SessionID, event.SnapshotID)
	case "quote_upsert":
		var event dto.CollectorStreamQuoteUpsert
		if err := json.Unmarshal(payload, &event); err != nil {
			return s.writeFrame(conn, dto.CollectorStreamError{
				Type:      "error",
				SessionID: state.sessionID(),
				Code:      "invalid_quote_upsert",
				Message:   "quote_upsert frame is invalid",
			})
		}
		if err := s.requireEventSource(conn, state, event.SessionID, event.Source); err != nil {
			return err
		}
		changed, quote, err := s.store.ApplyQuoteUpsert(ctx, event)
		if err != nil {
			return err
		}
		if changed {
			s.bufferOrPublish(ctx, state, event.SnapshotID, event.Source, quote)
		}
		return nil
	case "quote_remove":
		var event dto.CollectorStreamQuoteRemove
		if err := json.Unmarshal(payload, &event); err != nil {
			return s.writeFrame(conn, dto.CollectorStreamError{
				Type:      "error",
				SessionID: state.sessionID(),
				Code:      "invalid_quote_remove",
				Message:   "quote_remove frame is invalid",
			})
		}
		if err := s.requireEventSource(conn, state, event.SessionID, event.Source); err != nil {
			return err
		}
		changed, quote, err := s.store.ApplyQuoteRemove(ctx, event)
		if err != nil {
			return err
		}
		if changed {
			s.bufferOrPublish(ctx, state, event.SnapshotID, event.Source, quote)
		}
		return nil
	case "snapshot_commit":
		var event dto.CollectorStreamSnapshotCommit
		if err := json.Unmarshal(payload, &event); err != nil {
			return s.writeFrame(conn, dto.CollectorStreamError{
				Type:      "error",
				SessionID: state.sessionID(),
				Code:      "invalid_snapshot_commit",
				Message:   "snapshot_commit frame is invalid",
			})
		}
		if err := s.requireActiveSession(conn, state, event.SessionID); err != nil {
			return err
		}
		changed, err := s.store.CommitSnapshot(ctx, state.hello.Source, event.SessionID, event)
		if err != nil {
			return err
		}
		pending := append([]models.OddsQuote(nil), state.pendingSnapshots[event.SnapshotID]...)
		delete(state.pendingSnapshots, event.SnapshotID)
		pending = append(pending, changed...)
		return s.publishQuotes(ctx, state.hello.Source, dedupeQuotesByID(pending))
	case "heartbeat":
		var event dto.CollectorStreamHeartbeat
		if err := json.Unmarshal(payload, &event); err != nil {
			return s.writeFrame(conn, dto.CollectorStreamError{
				Type:      "error",
				SessionID: state.sessionID(),
				Code:      "invalid_heartbeat",
				Message:   "heartbeat frame is invalid",
			})
		}
		return s.requireActiveSession(conn, state, event.SessionID)
	default:
		return s.writeFrame(conn, dto.CollectorStreamError{
			Type:      "error",
			SessionID: state.sessionID(),
			Code:      "unsupported_type",
			Message:   "collector stream frame type is not supported",
		})
	}
}

func (s *StreamService) handleHello(
	conn *websocket.Conn,
	state *collectorStreamConnectionState,
	hello dto.CollectorStreamHello,
) error {
	if state.hello != nil {
		return s.writeFrame(conn, dto.CollectorStreamError{
			Type:      "error",
			SessionID: state.sessionID(),
			Code:      "duplicate_hello",
			Message:   "collector stream already received hello for this connection",
		})
	}
	if hello.ProtocolVersion != dto.CollectorStreamProtocolVersion ||
		hello.SessionID == "" ||
		hello.Source.CollectorID == "" ||
		hello.Source.BookmakerID == "" ||
		hello.Source.LobbyID == "" {
		return s.writeFrame(conn, dto.CollectorStreamError{
			Type:      "error",
			SessionID: hello.SessionID,
			Code:      "invalid_hello",
			Message:   "collector hello frame is missing required fields or protocol version",
		})
	}

	state.hello = &hello
	s.sessions.Register(hello.Source, hello.SessionID)

	return s.writeFrame(conn, dto.CollectorStreamHelloAck{
		Type:            "hello_ack",
		ProtocolVersion: dto.CollectorStreamProtocolVersion,
		SessionID:       hello.SessionID,
		Source:          hello.Source,
		ServerTime:      time.Now().UTC(),
	})
}

func (s *StreamService) requireActiveSession(
	conn *websocket.Conn,
	state *collectorStreamConnectionState,
	sessionID string,
) error {
	if state.hello == nil || state.hello.SessionID != sessionID {
		return s.writeFrame(conn, dto.CollectorStreamError{
			Type:      "error",
			SessionID: sessionID,
			Code:      "invalid_session",
			Message:   "collector stream session does not match this connection",
		})
	}
	if !s.sessions.IsActive(state.hello.Source, sessionID) {
		_ = s.writeFrame(conn, dto.CollectorStreamError{
			Type:      "error",
			SessionID: sessionID,
			Code:      "stale_session",
			Message:   "collector stream session is stale",
		})
		return errors.New("stale collector stream session")
	}
	return nil
}

func (s *StreamService) requireEventSource(
	conn *websocket.Conn,
	state *collectorStreamConnectionState,
	sessionID string,
	source dto.CollectorSource,
) error {
	if err := s.requireActiveSession(conn, state, sessionID); err != nil {
		return err
	}
	if source != state.hello.Source {
		return s.writeFrame(conn, dto.CollectorStreamError{
			Type:      "error",
			SessionID: sessionID,
			Code:      "source_mismatch",
			Message:   "collector stream source does not match hello source",
		})
	}
	return nil
}

func (s *StreamService) bufferOrPublish(
	ctx context.Context,
	state *collectorStreamConnectionState,
	snapshotID string,
	source dto.CollectorSource,
	quote models.OddsQuote,
) {
	if snapshotID != "" {
		state.pendingSnapshots[snapshotID] = append(state.pendingSnapshots[snapshotID], quote)
		return
	}

	if err := s.publishQuotes(ctx, source, []models.OddsQuote{quote}); err != nil && s.log != nil {
		s.log.Warn(
			"collector stream publish failed",
			"collector_id", source.CollectorID,
			"bookmaker_id", source.BookmakerID,
			"lobby_id", source.LobbyID,
			"error", err.Error(),
		)
	}
}

func (s *StreamService) publishQuotes(
	ctx context.Context,
	source dto.CollectorSource,
	quotes []models.OddsQuote,
) error {
	if len(quotes) == 0 {
		return nil
	}

	if s.publisher != nil {
		if err := s.publisher.PublishOddsUpdated(
			ctx,
			BuildOddsUpdatedEvent(
				source.CollectorID,
				source.BookmakerID,
				source.LobbyID,
				quotes,
			),
		); err != nil {
			return err
		}
	}
	if s.notifier != nil {
		s.notifier.Trigger()
	}
	return nil
}

func (s *StreamService) writeFrame(conn *websocket.Conn, payload any) error {
	return conn.WriteJSON(payload)
}

type collectorStreamConnectionState struct {
	hello            *dto.CollectorStreamHello
	pendingSnapshots map[string][]models.OddsQuote
}

func (s *collectorStreamConnectionState) sessionID() string {
	if s.hello == nil {
		return ""
	}
	return s.hello.SessionID
}

type collectorSessionRegistry struct {
	mu     sync.RWMutex
	active map[string]string
}

func (r *collectorSessionRegistry) Register(source dto.CollectorSource, sessionID string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.active[repository.OddsSourceKey(source.BookmakerID, source.LobbyID)] = sessionID
}

func (r *collectorSessionRegistry) IsActive(source dto.CollectorSource, sessionID string) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.active[repository.OddsSourceKey(source.BookmakerID, source.LobbyID)] == sessionID
}

func (r *collectorSessionRegistry) Unregister(source dto.CollectorSource, sessionID string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	key := repository.OddsSourceKey(source.BookmakerID, source.LobbyID)
	if r.active[key] == sessionID {
		delete(r.active, key)
	}
}

func dedupeQuotesByID(items []models.OddsQuote) []models.OddsQuote {
	if len(items) < 2 {
		return items
	}

	deduped := make([]models.OddsQuote, 0, len(items))
	indexByID := make(map[string]int, len(items))

	for _, item := range items {
		if index, ok := indexByID[item.ID]; ok {
			if item.CollectedAt.After(deduped[index].CollectedAt) {
				deduped[index] = item
			}
			continue
		}
		indexByID[item.ID] = len(deduped)
		deduped = append(deduped, item)
	}

	return deduped
}
