package notification

import "context"

type Severity string

const (
	SeverityInfo  Severity = "INFO"
	SeverityWarn  Severity = "WARN"
	SeverityError Severity = "ERROR"
)

type Message struct {
	Subject  string            `json:"subject"`
	Body     string            `json:"body"`
	Severity Severity          `json:"severity"`
	Metadata map[string]string `json:"metadata"`
}

type Notifier interface {
	Send(ctx context.Context, audience string, message Message) error
}
