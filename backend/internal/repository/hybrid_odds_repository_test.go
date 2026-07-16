package repository

import (
	"context"
	"testing"
	"time"

	"surebet/backend/internal/models"
)

func TestHybridOddsRepositoryListCurrentUsesMigratedSourcesOnlyInPhase2(t *testing.T) {
	migrated := stubCurrentOddsRepository{
		current: []models.OddsQuote{
			{BookmakerID: "jun88", LobbyID: "cmd", FixtureID: "fixture-a", MarketID: "market-a", OutcomeID: "outcome-a"},
			{BookmakerID: "8xbet", LobbyID: "default", FixtureID: "fixture-b", MarketID: "market-b", OutcomeID: "outcome-b"},
		},
	}
	legacy := stubCurrentOddsRepository{
		current: []models.OddsQuote{
			{BookmakerID: "8xbet", LobbyID: "default", FixtureID: "fixture-b", MarketID: "market-b", OutcomeID: "outcome-b"},
			{BookmakerID: "jun88", LobbyID: "cmd", FixtureID: "fixture-c", MarketID: "market-c", OutcomeID: "outcome-c"},
		},
	}

	repo := NewHybridOddsRepository(migrated, legacy)
	items, err := repo.ListCurrent(context.Background(), "", "", "")
	if err != nil {
		t.Fatalf("list current: %v", err)
	}

	if len(items) != 2 {
		t.Fatalf("expected phase2 reads to come from migrated sources only, got %+v", items)
	}
}

func TestHybridOddsRepositoryDetectorCandidatesUseMigratedSourcesOnlyInPhase2(t *testing.T) {
	migrated := stubCurrentOddsRepository{
		detector: []models.OddsQuote{
			{BookmakerID: "jun88", LobbyID: "cmd", FixtureID: "fixture-a", MarketID: "market-a", OutcomeID: "outcome-a"},
			{BookmakerID: "8xbet", LobbyID: "default", FixtureID: "fixture-b", MarketID: "market-b", OutcomeID: "outcome-b"},
		},
	}
	legacy := stubCurrentOddsRepository{
		detector: []models.OddsQuote{
			{BookmakerID: "8xbet", LobbyID: "default", FixtureID: "fixture-b", MarketID: "market-b", OutcomeID: "outcome-b"},
			{BookmakerID: "jun88", LobbyID: "cmd", FixtureID: "fixture-c", MarketID: "market-c", OutcomeID: "outcome-c"},
		},
	}

	repo := NewHybridOddsRepository(migrated, legacy)
	items, err := repo.ListCurrentDetectorCandidatesBySource(context.Background(), time.Now().UTC())
	if err != nil {
		t.Fatalf("list detector candidates: %v", err)
	}

	if len(items) != 2 {
		t.Fatalf("expected phase2 detector candidates to come from migrated sources only, got %+v", items)
	}
}

type stubCurrentOddsRepository struct {
	byFixture []models.OddsQuote
	current   []models.OddsQuote
	live      []models.OddsQuote
	detector  []models.OddsQuote
}

func (s stubCurrentOddsRepository) ListByFixture(context.Context, string) ([]models.OddsQuote, error) {
	return append([]models.OddsQuote(nil), s.byFixture...), nil
}

func (s stubCurrentOddsRepository) ListCurrent(context.Context, string, string, string) ([]models.OddsQuote, error) {
	return append([]models.OddsQuote(nil), s.current...), nil
}

func (s stubCurrentOddsRepository) ListCurrentLive(context.Context, string, string, string) ([]models.OddsQuote, error) {
	return append([]models.OddsQuote(nil), s.live...), nil
}

func (s stubCurrentOddsRepository) ListCurrentDetectorCandidatesBySource(context.Context, time.Time) ([]models.OddsQuote, error) {
	return append([]models.OddsQuote(nil), s.detector...), nil
}
