package repository

import (
	"context"
	"sort"
	"time"

	"surebet/backend/internal/models"
)

type HybridOddsRepository struct {
	migrated CurrentOddsRepository
	legacy   CurrentOddsRepository
}

func NewHybridOddsRepository(
	migrated CurrentOddsRepository,
	legacy CurrentOddsRepository,
) *HybridOddsRepository {
	return &HybridOddsRepository{
		migrated: migrated,
		legacy:   legacy,
	}
}

func (r *HybridOddsRepository) ListByFixture(
	ctx context.Context,
	fixtureID string,
) ([]models.OddsQuote, error) {
	items := make([]models.OddsQuote, 0)

	if r.migrated != nil {
		migrated, err := r.migrated.ListByFixture(ctx, fixtureID)
		if err != nil {
			return nil, err
		}
		items = append(items, filterQuotesBySources(migrated, MigratedOddsSources())...)
	}

	if r.legacy != nil {
		legacy, err := r.legacy.ListByFixture(ctx, fixtureID)
		if err != nil {
			return nil, err
		}
		items = append(items, filterQuotesBySources(legacy, LegacyOddsSources())...)
	}

	sort.Slice(items, func(i, j int) bool {
		return items[i].CollectedAt.After(items[j].CollectedAt)
	})

	return items, nil
}

func (r *HybridOddsRepository) ListCurrent(
	ctx context.Context,
	bookmakerID, lobbyID, fixtureID string,
) ([]models.OddsQuote, error) {
	return r.listCurrent(
		ctx,
		bookmakerID,
		lobbyID,
		fixtureID,
		func(
			repo CurrentOddsRepository,
			ctx context.Context,
			bookmakerID, lobbyID, fixtureID string,
		) ([]models.OddsQuote, error) {
			return repo.ListCurrent(ctx, bookmakerID, lobbyID, fixtureID)
		},
	)
}

func (r *HybridOddsRepository) ListCurrentLive(
	ctx context.Context,
	bookmakerID, lobbyID, fixtureID string,
) ([]models.OddsQuote, error) {
	return r.listCurrent(
		ctx,
		bookmakerID,
		lobbyID,
		fixtureID,
		func(
			repo CurrentOddsRepository,
			ctx context.Context,
			bookmakerID, lobbyID, fixtureID string,
		) ([]models.OddsQuote, error) {
			return repo.ListCurrentLive(ctx, bookmakerID, lobbyID, fixtureID)
		},
	)
}

func (r *HybridOddsRepository) ListCurrentDetectorCandidatesBySource(
	ctx context.Context,
	minCollectedAt time.Time,
) ([]models.OddsQuote, error) {
	items := make([]models.OddsQuote, 0)

	if r.migrated != nil {
		migrated, err := r.migrated.ListCurrentDetectorCandidatesBySource(ctx, minCollectedAt)
		if err != nil {
			return nil, err
		}
		items = append(items, filterQuotesBySources(migrated, MigratedOddsSources())...)
	}

	if r.legacy != nil {
		legacy, err := r.legacy.ListCurrentDetectorCandidatesBySource(ctx, minCollectedAt)
		if err != nil {
			return nil, err
		}
		items = append(items, filterQuotesBySources(legacy, LegacyOddsSources())...)
	}

	SortOddsQuotesForDisplay(items)
	return items, nil
}

func (r *HybridOddsRepository) listCurrent(
	ctx context.Context,
	bookmakerID, lobbyID, fixtureID string,
	loader func(
		repo CurrentOddsRepository,
		ctx context.Context,
		bookmakerID, lobbyID, fixtureID string,
	) ([]models.OddsQuote, error),
) ([]models.OddsQuote, error) {
	items := make([]models.OddsQuote, 0)

	migratedSources := MatchOddsSources(bookmakerID, lobbyID, MigratedOddsSources())
	if r.migrated != nil && len(migratedSources) > 0 {
		migrated, err := loader(r.migrated, ctx, bookmakerID, lobbyID, fixtureID)
		if err != nil {
			return nil, err
		}
		items = append(items, filterQuotesBySources(migrated, migratedSources)...)
	}

	legacySources := MatchOddsSources(bookmakerID, lobbyID, LegacyOddsSources())
	if r.legacy != nil && len(legacySources) > 0 {
		legacy, err := loader(r.legacy, ctx, bookmakerID, lobbyID, fixtureID)
		if err != nil {
			return nil, err
		}
		items = append(items, filterQuotesBySources(legacy, legacySources)...)
	}

	SortOddsQuotesForDisplay(items)
	return items, nil
}

func SortOddsQuotesForDisplay(items []models.OddsQuote) {
	sort.Slice(items, func(i, j int) bool {
		if items[i].FixtureID != items[j].FixtureID {
			return items[i].FixtureID < items[j].FixtureID
		}
		if items[i].MarketID != items[j].MarketID {
			return items[i].MarketID < items[j].MarketID
		}
		if items[i].OutcomeID != items[j].OutcomeID {
			return items[i].OutcomeID < items[j].OutcomeID
		}
		if !items[i].CollectedAt.Equal(items[j].CollectedAt) {
			return items[i].CollectedAt.After(items[j].CollectedAt)
		}
		if items[i].BookmakerID != items[j].BookmakerID {
			return items[i].BookmakerID < items[j].BookmakerID
		}
		return items[i].LobbyID < items[j].LobbyID
	})
}

func filterQuotesBySources(items []models.OddsQuote, sources []OddsSource) []models.OddsQuote {
	if len(items) == 0 || len(sources) == 0 {
		return nil
	}

	filtered := make([]models.OddsQuote, 0, len(items))
	for _, item := range items {
		if ContainsOddsSource(sources, item.BookmakerID, item.LobbyID) {
			filtered = append(filtered, item)
		}
	}
	return filtered
}
