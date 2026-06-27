package health

import (
	"context"
	"time"
)

type Status string

const (
	StatusPass Status = "PASS"
	StatusWarn Status = "WARN"
	StatusFail Status = "FAIL"
)

type Check struct {
	Name    string            `json:"name"`
	Status  Status            `json:"status"`
	Details map[string]string `json:"details"`
}

type Snapshot struct {
	Service   string    `json:"service"`
	Status    Status    `json:"status"`
	CheckedAt time.Time `json:"checked_at"`
	Checks    []Check   `json:"checks"`
}

type Reporter interface {
	Snapshot(ctx context.Context) Snapshot
}

type staticReporter struct {
	service string
}

func NewStaticReporter(service string) Reporter {
	return staticReporter{service: service}
}

func (r staticReporter) Snapshot(context.Context) Snapshot {
	return Snapshot{
		Service:   r.service,
		Status:    StatusPass,
		CheckedAt: time.Now().UTC(),
		Checks: []Check{
			{
				Name:   "architecture",
				Status: StatusPass,
				Details: map[string]string{
					"state": "scaffold-only",
				},
			},
		},
	}
}
