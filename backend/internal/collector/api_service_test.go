package collector

import (
	"testing"

	"surebet/backend/internal/dto"
)

func TestBuildFixtureMarkerIgnoresEventStartAt(t *testing.T) {
	first := buildFixtureMarker(dto.CollectorSelection{
		FixtureID:    "fixture-a",
		HomeTeam:     "Team A",
		AwayTeam:     "Team B",
		EventStartAt: "07/11 20:00",
	})
	second := buildFixtureMarker(dto.CollectorSelection{
		FixtureID:    "fixture-b",
		HomeTeam:     "Team A",
		AwayTeam:     "Team B",
		EventStartAt: "07/11 21:00",
	})

	if first != "team-a|team-b" {
		t.Fatalf("expected fixture marker to use only teams, got %q", first)
	}
	if second != first {
		t.Fatalf("expected fixture marker to ignore event start time, got %q and %q", first, second)
	}
}
