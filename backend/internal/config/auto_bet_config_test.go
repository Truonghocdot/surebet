package config

import "testing"

func TestAutoBetModeUsesTwoPublicSettings(t *testing.T) {
	tests := []struct {
		mode              string
		simulationEnabled bool
		liveEnabled       bool
		commitEnabled     bool
	}{
		{mode: "off"},
		{mode: "simulation", simulationEnabled: true},
		{mode: "dry-run", liveEnabled: true},
		{mode: " LIVE ", liveEnabled: true, commitEnabled: true},
		{mode: "invalid"},
	}

	for _, test := range tests {
		t.Run(test.mode, func(t *testing.T) {
			t.Setenv("AUTO_BET_MODE", test.mode)
			t.Setenv("AUTO_BET_TOTAL_STAKE_VND", "120000")
			// Legacy switches must no longer be able to enable betting.
			t.Setenv("AUTO_BET_LIVE_ENABLED", "true")
			t.Setenv("AUTO_BET_LIVE_COMMIT_ENABLED", "true")

			cfg := LoadFromEnv()
			if cfg.AutoBetSimulation.Enabled != test.simulationEnabled {
				t.Fatalf("simulation enabled = %v, want %v", cfg.AutoBetSimulation.Enabled, test.simulationEnabled)
			}
			if cfg.AutoBetLive.Enabled != test.liveEnabled {
				t.Fatalf("live enabled = %v, want %v", cfg.AutoBetLive.Enabled, test.liveEnabled)
			}
			if cfg.AutoBetLive.CommitEnabled != test.commitEnabled {
				t.Fatalf("commit enabled = %v, want %v", cfg.AutoBetLive.CommitEnabled, test.commitEnabled)
			}
			if cfg.AutoBetLive.TotalStakeVND != 120_000 || cfg.AutoBetSimulation.TotalStakeVND != 120_000 {
				t.Fatalf("unexpected total stake: live=%d simulation=%d", cfg.AutoBetLive.TotalStakeVND, cfg.AutoBetSimulation.TotalStakeVND)
			}
			if cfg.AutoBetLive.AccountID != "surebet-primary" {
				t.Fatalf("account ID = %q", cfg.AutoBetLive.AccountID)
			}
		})
	}
}
