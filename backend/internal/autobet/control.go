package autobet

import (
	"errors"
	"sync"
	"time"
)

var ErrInvalidTotalStake = errors.New("auto-bet total stake must be a positive integer")

// Snapshot is the small, process-local control plane used by the operator UI.
// It is intentionally volatile: the environment remains the source of the
// initial safety mode after a process restart.
type Snapshot struct {
	Enabled       bool      `json:"enabled"`
	TotalStakeVND int64     `json:"total_stake_vnd"`
	UpdatedAt     time.Time `json:"updated_at"`
}

type Control struct {
	mu    sync.RWMutex
	state Snapshot
}

func NewControl(enabled bool, totalStakeVND int64) *Control {
	if totalStakeVND <= 0 {
		totalStakeVND = 100_000
	}
	return &Control{state: Snapshot{
		Enabled:       enabled,
		TotalStakeVND: totalStakeVND,
		UpdatedAt:     time.Now().UTC(),
	}}
}

func (c *Control) Snapshot() Snapshot {
	if c == nil {
		return Snapshot{}
	}
	c.mu.RLock()
	state := c.state
	c.mu.RUnlock()
	return state
}

func (c *Control) Update(enabled bool, totalStakeVND int64) (Snapshot, error) {
	if c == nil {
		return Snapshot{}, errors.New("auto-bet control is unavailable")
	}
	if totalStakeVND <= 0 {
		return Snapshot{}, ErrInvalidTotalStake
	}
	c.mu.Lock()
	c.state = Snapshot{
		Enabled:       enabled,
		TotalStakeVND: totalStakeVND,
		UpdatedAt:     time.Now().UTC(),
	}
	state := c.state
	c.mu.Unlock()
	return state, nil
}
