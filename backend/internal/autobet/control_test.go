package autobet

import (
	"testing"
)

func TestControlStoresOnlySmallVolatileState(t *testing.T) {
	control := NewControl(false, 100_000)
	initial := control.Snapshot()
	if initial.Enabled || initial.TotalStakeVND != 100_000 || initial.UpdatedAt.IsZero() {
		t.Fatalf("unexpected initial state: %+v", initial)
	}
	updated, err := control.Update(true, 250_000)
	if err != nil {
		t.Fatalf("update control: %v", err)
	}
	if !updated.Enabled || updated.TotalStakeVND != 250_000 {
		t.Fatalf("unexpected updated state: %+v", updated)
	}
}

func TestControlRejectsInvalidStake(t *testing.T) {
	if _, err := NewControl(false, 100_000).Update(true, 0); err != ErrInvalidTotalStake {
		t.Fatalf("expected invalid stake error, got %v", err)
	}
}

func TestControlDisablePreservesStakeAndTurnsOff(t *testing.T) {
	control := NewControl(true, 250_000)
	state := control.Disable()
	if state.Enabled || state.TotalStakeVND != 250_000 || state.UpdatedAt.IsZero() {
		t.Fatalf("unexpected disabled state: %+v", state)
	}
}
