package websocket

import "context"

type Channel string

const (
	ChannelOdds     Channel = "odds"
	ChannelSurebets Channel = "surebets"
	ChannelOrders   Channel = "orders"
	ChannelAlerts   Channel = "alerts"
)

type Envelope struct {
	Channel   Channel `json:"channel"`
	EventType string  `json:"event_type"`
	Payload   any     `json:"payload"`
}

type Hub interface {
	Broadcast(ctx context.Context, message Envelope) error
}
