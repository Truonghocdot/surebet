package collector

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"

	"surebet/backend/internal/dto"
	"surebet/backend/internal/logger"
	"surebet/backend/internal/models"
	"surebet/backend/internal/repository"
)

type StreamOddsStateStore interface {
	ObserveSource(ctx context.Context, source dto.CollectorSource, observedAt time.Time) error
	BeginSnapshot(ctx context.Context, source dto.CollectorSource, sessionID, snapshotID string) error
	ApplyQuoteUpsert(ctx context.Context, event dto.CollectorStreamQuoteUpsert) (bool, models.OddsQuote, error)
	ApplyQuoteUpsertBatch(ctx context.Context, events []dto.CollectorStreamQuoteUpsert) ([]models.OddsQuote, error)
	ApplyQuoteRemove(ctx context.Context, event dto.CollectorStreamQuoteRemove) (bool, models.OddsQuote, error)
	CommitSnapshot(
		ctx context.Context,
		source dto.CollectorSource,
		sessionID string,
		event dto.CollectorStreamSnapshotCommit,
	) ([]models.OddsQuote, error)
}

type SurebetNotifier interface {
	Trigger()
}

type multiSurebetNotifier struct {
	notifiers []SurebetNotifier
}

func NewMultiSurebetNotifier(notifiers ...SurebetNotifier) SurebetNotifier {
	return multiSurebetNotifier{notifiers: notifiers}
}

func (n multiSurebetNotifier) Trigger() {
	for _, notifier := range n.notifiers {
		if notifier != nil {
			notifier.Trigger()
		}
	}
}

type StreamService struct {
	store         StreamOddsStateStore
	publisher     EventPublisher
	notifier      SurebetNotifier
	log           logger.Logger
	upgrader      websocket.Upgrader
	sessions      collectorSessionRegistry
	connections   collectorConnectionRegistry
	writeMu       sync.Mutex
	confirmMu     sync.Mutex
	confirmations map[string]chan dto.CollectorConfirmQuoteResponse
	batchMu       sync.Mutex
	batches       map[string]*pendingSourcePublish
	debounce      time.Duration
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
		connections: collectorConnectionRegistry{
			active: make(map[string]activeCollectorConnection),
		},
		confirmations: make(map[string]chan dto.CollectorConfirmQuoteResponse),
		batches:       make(map[string]*pendingSourcePublish),
		debounce:      250 * time.Millisecond,
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
			s.connections.Unregister(state.hello.Source, state.hello.SessionID)
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
	case "quote_upsert_batch":
		var batch dto.CollectorStreamQuoteUpsertBatch
		if err := json.Unmarshal(payload, &batch); err != nil {
			return s.writeFrame(conn, dto.CollectorStreamError{
				Type:      "error",
				SessionID: state.sessionID(),
				Code:      "invalid_quote_upsert_batch",
				Message:   "quote_upsert_batch frame is invalid",
			})
		}
		if err := s.requireEventSource(conn, state, batch.SessionID, batch.Source); err != nil {
			return err
		}

		events := make([]dto.CollectorStreamQuoteUpsert, len(batch.Items))
		for i, item := range batch.Items {
			events[i] = dto.CollectorStreamQuoteUpsert{
				Type:       "quote_upsert",
				SessionID:  batch.SessionID,
				SnapshotID: batch.SnapshotID,
				Seq:        batch.Seq,
				OccurredAt: item.OccurredAt,
				Source:     batch.Source,
				RawIDs:     item.RawIDs,
				Markers:    item.Markers,
				Quote:      item.Quote,
			}
		}

		changedQuotes, err := s.store.ApplyQuoteUpsertBatch(ctx, events)
		if err != nil {
			return err
		}
		for _, quote := range changedQuotes {
			s.bufferOrPublish(ctx, state, batch.SnapshotID, batch.Source, quote)
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
		if err := s.requireActiveSession(conn, state, event.SessionID); err != nil {
			return err
		}
		return s.store.ObserveSource(ctx, state.hello.Source, event.SentAt)
	case "confirm_quote_response":
		var response dto.CollectorConfirmQuoteResponse
		if err := json.Unmarshal(payload, &response); err != nil {
			return s.writeFrame(conn, dto.CollectorStreamError{
				Type:      "error",
				SessionID: state.sessionID(),
				Code:      "invalid_confirm_quote_response",
				Message:   "collector confirmation response is invalid",
			})
		}
		if err := s.requireActiveSession(conn, state, response.SessionID); err != nil {
			return err
		}
		s.deliverQuoteConfirmation(response)
		return nil
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
	s.connections.Register(hello.Source, hello.SessionID, conn)

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

	s.enqueueDeltaPublish(source, quote)
}

func (s *StreamService) publishQuotes(
	ctx context.Context,
	source dto.CollectorSource,
	quotes []models.OddsQuote,
) error {
	if len(quotes) == 0 {
		return nil
	}

	if s.notifier != nil {
		s.notifier.Trigger()
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
	return nil
}

func (s *StreamService) writeFrame(conn *websocket.Conn, payload any) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	return conn.WriteJSON(payload)
}

func (s *StreamService) ConfirmQuote(
	ctx context.Context,
	source dto.CollectorSource,
	fixtureID, marketID, outcomeID string,
) (dto.CollectorConfirmQuoteResponse, error) {
	connection, ok := s.connections.Get(source)
	if !ok || !s.sessions.IsActive(source, connection.sessionID) {
		return dto.CollectorConfirmQuoteResponse{}, errors.New("collector source is not connected")
	}

	requestID := uuid.NewString()
	responseChannel := make(chan dto.CollectorConfirmQuoteResponse, 1)
	s.confirmMu.Lock()
	s.confirmations[requestID] = responseChannel
	s.confirmMu.Unlock()
	defer func() {
		s.confirmMu.Lock()
		delete(s.confirmations, requestID)
		s.confirmMu.Unlock()
	}()

	const timeoutMS = 2000
	if err := s.writeFrame(connection.conn, dto.CollectorConfirmQuoteRequest{
		Type:        "confirm_quote",
		SessionID:   connection.sessionID,
		RequestID:   requestID,
		RequestedAt: time.Now().UTC(),
		FixtureID:   fixtureID,
		MarketID:    marketID,
		OutcomeID:   outcomeID,
		TimeoutMS:   timeoutMS,
	}); err != nil {
		return dto.CollectorConfirmQuoteResponse{}, err
	}

	select {
	case <-ctx.Done():
		return dto.CollectorConfirmQuoteResponse{}, ctx.Err()
	case response := <-responseChannel:
		if response.Error != "" {
			return response, errors.New(response.Error)
		}
		return response, nil
	}
}

func (s *StreamService) deliverQuoteConfirmation(response dto.CollectorConfirmQuoteResponse) {
	s.confirmMu.Lock()
	responseChannel := s.confirmations[response.RequestID]
	s.confirmMu.Unlock()
	if responseChannel == nil {
		return
	}
	select {
	case responseChannel <- response:
	default:
	}
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

type activeCollectorConnection struct {
	sessionID string
	conn      *websocket.Conn
}

type collectorConnectionRegistry struct {
	mu     sync.RWMutex
	active map[string]activeCollectorConnection
}

func (r *collectorConnectionRegistry) Register(
	source dto.CollectorSource,
	sessionID string,
	conn *websocket.Conn,
) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.active[repository.OddsSourceKey(source.BookmakerID, source.LobbyID)] = activeCollectorConnection{
		sessionID: sessionID,
		conn:      conn,
	}
}

func (r *collectorConnectionRegistry) Get(source dto.CollectorSource) (activeCollectorConnection, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	connection, ok := r.active[repository.OddsSourceKey(source.BookmakerID, source.LobbyID)]
	return connection, ok
}

func (r *collectorConnectionRegistry) Unregister(source dto.CollectorSource, sessionID string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	key := repository.OddsSourceKey(source.BookmakerID, source.LobbyID)
	if r.active[key].sessionID == sessionID {
		delete(r.active, key)
	}
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

type pendingSourcePublish struct {
	source dto.CollectorSource
	quotes []models.OddsQuote
	timer  *time.Timer
}

func (s *StreamService) enqueueDeltaPublish(source dto.CollectorSource, quote models.OddsQuote) {
	key := repository.OddsSourceKey(source.BookmakerID, source.LobbyID)

	s.batchMu.Lock()
	pending := s.batches[key]
	if pending == nil {
		pending = &pendingSourcePublish{
			source: source,
		}
		s.batches[key] = pending
		pending.timer = time.AfterFunc(s.debounce, func() {
			s.flushDeltaPublish(key)
		})
	}
	pending.quotes = append(pending.quotes, quote)
	s.batchMu.Unlock()
}

func (s *StreamService) flushDeltaPublish(key string) {
	s.batchMu.Lock()
	pending := s.batches[key]
	if pending == nil {
		s.batchMu.Unlock()
		return
	}
	delete(s.batches, key)
	source := pending.source
	quotes := dedupeQuotesByID(append([]models.OddsQuote(nil), pending.quotes...))
	s.batchMu.Unlock()

	if len(quotes) == 0 {
		return
	}

	if err := s.publishQuotes(context.Background(), source, quotes); err != nil && s.log != nil {
		s.log.Warn(
			"collector stream publish failed",
			"collector_id", source.CollectorID,
			"bookmaker_id", source.BookmakerID,
			"lobby_id", source.LobbyID,
			"error", err.Error(),
		)
	}
}
