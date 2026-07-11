package realtime

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/gorilla/websocket"

	"surebet/backend/internal/logger"
)

const (
	writeWait  = 10 * time.Second
	pongWait   = 60 * time.Second
	pingPeriod = (pongWait * 9) / 10
)

type Event struct {
	Type    string    `json:"type"`
	SentAt  time.Time `json:"sent_at"`
	Payload any       `json:"payload,omitempty"`
}

type Hub struct {
	clients    map[*client]struct{}
	register   chan *client
	unregister chan *client
	broadcast  chan Event
	upgrader   websocket.Upgrader
	log        logger.Logger
}

func NewHub(log logger.Logger) *Hub {
	return &Hub{
		clients:    make(map[*client]struct{}),
		register:   make(chan *client),
		unregister: make(chan *client),
		broadcast:  make(chan Event, 256),
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool {
				return true
			},
		},
		log: log,
	}
}

func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.clients[client] = struct{}{}
			h.info("websocket client connected", "clients", len(h.clients))
		case client := <-h.unregister:
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send)
				h.info("websocket client disconnected", "clients", len(h.clients))
			}
		case event := <-h.broadcast:
			for client := range h.clients {
				select {
				case client.send <- event:
				default:
					delete(h.clients, client)
					close(client.send)
					h.warn("websocket client dropped because send buffer is full")
				}
			}
		}
	}
}

func (h *Hub) Broadcast(event Event) {
	if event.SentAt.IsZero() {
		event.SentAt = time.Now().UTC()
	}

	select {
	case h.broadcast <- event:
	default:
		h.warn("websocket event dropped because hub buffer is full", "type", event.Type)
	}
}

func (h *Hub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		h.warn("websocket upgrade failed", "error", err.Error())
		return
	}

	client := &client{
		hub:  h,
		conn: conn,
		send: make(chan Event, 32),
	}

	h.register <- client
	client.enqueue(Event{
		Type:   "connected",
		SentAt: time.Now().UTC(),
		Payload: map[string]string{
			"message": "websocket connected",
		},
	})

	go client.writePump()
	go client.readPump()
}

func (h *Hub) info(message string, fields ...any) {
	if h.log != nil {
		h.log.Info(message, fields...)
	}
}

func (h *Hub) warn(message string, fields ...any) {
	if h.log != nil {
		h.log.Warn(message, fields...)
	}
}

type client struct {
	hub  *Hub
	conn *websocket.Conn
	send chan Event
}

func (c *client) enqueue(event Event) {
	select {
	case c.send <- event:
	default:
		c.hub.warn("websocket initial event dropped because send buffer is full")
	}
}

func (c *client) readPump() {
	defer func() {
		c.hub.unregister <- c
		_ = c.conn.Close()
	}()

	c.conn.SetReadLimit(512)
	_ = c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		return c.conn.SetReadDeadline(time.Now().Add(pongWait))
	})

	for {
		if _, _, err := c.conn.NextReader(); err != nil {
			return
		}
	}
}

func (c *client) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		_ = c.conn.Close()
	}()

	for {
		select {
		case event, ok := <-c.send:
			_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				_ = c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			payload, err := json.Marshal(event)
			if err != nil {
				c.hub.warn("websocket event marshal failed", "error", err.Error())
				continue
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, payload); err != nil {
				return
			}
		case <-ticker.C:
			_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
