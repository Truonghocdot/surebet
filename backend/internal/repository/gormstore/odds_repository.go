package gormstore

import (
	"context"
	"fmt"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"surebet/backend/internal/models"
)

type OddsSnapshotRepository struct {
	db *gorm.DB
}

const oddsUpsertBatchSize = 250

func NewOddsSnapshotRepository(db *gorm.DB) *OddsSnapshotRepository {
	return &OddsSnapshotRepository{db: db}
}

func (r *OddsSnapshotRepository) Upsert(ctx context.Context, quotes []models.OddsQuote) error {
	if len(quotes) == 0 {
		return nil
	}

	quotes = dedupeOddsQuotes(quotes)

	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		return tx.
			Clauses(clause.OnConflict{
				Columns: []clause.Column{{Name: "id"}},
				DoUpdates: clause.Assignments(map[string]any{
					"bookmaker_id":    clause.Column{Name: "excluded.bookmaker_id"},
					"lobby_id":        clause.Column{Name: "excluded.lobby_id"},
					"fixture_id":      clause.Column{Name: "excluded.fixture_id"},
					"home_team":       clause.Column{Name: "excluded.home_team"},
					"away_team":       clause.Column{Name: "excluded.away_team"},
					"sport":           clause.Column{Name: "excluded.sport"},
					"market_id":       clause.Column{Name: "excluded.market_id"},
					"market_name":     clause.Column{Name: "excluded.market_name"},
					"outcome_id":      clause.Column{Name: "excluded.outcome_id"},
					"outcome_name":    clause.Column{Name: "excluded.outcome_name"},
					"odds":            clause.Column{Name: "excluded.odds"},
					"available_stake": clause.Column{Name: "excluded.available_stake"},
					"suspended":       clause.Column{Name: "excluded.suspended"},
					"collected_at":    clause.Column{Name: "excluded.collected_at"},
				}),
			}).
			CreateInBatches(&quotes, oddsUpsertBatchSize).Error
	})
}

func (r *OddsSnapshotRepository) ListByFixture(ctx context.Context, fixtureID string) ([]models.OddsQuote, error) {
	var quotes []models.OddsQuote
	err := r.db.WithContext(ctx).
		Where("fixture_id = ?", fixtureID).
		Order("collected_at desc").
		Find(&quotes).Error
	return quotes, err
}

func (r *OddsSnapshotRepository) ListCurrent(ctx context.Context, bookmakerID, lobbyID, fixtureID string) ([]models.OddsQuote, error) {
	var quotes []models.OddsQuote
	err := r.listCurrentQuery(r.db.WithContext(ctx), bookmakerID, lobbyID, fixtureID, currentQueryOptions{}).
		Find(&quotes).Error
	return quotes, err
}

func (r *OddsSnapshotRepository) ListCurrentLive(
	ctx context.Context,
	bookmakerID, lobbyID, fixtureID string,
) ([]models.OddsQuote, error) {
	var quotes []models.OddsQuote
	err := r.listCurrentQuery(r.db.WithContext(ctx), bookmakerID, lobbyID, fixtureID, currentQueryOptions{
		LiveOnly: true,
	}).Find(&quotes).Error
	return quotes, err
}

func (r *OddsSnapshotRepository) ListCurrentDetectorCandidates(
	ctx context.Context,
	minCollectedAt time.Time,
) ([]models.OddsQuote, error) {
	var quotes []models.OddsQuote
	err := r.listCurrentQuery(r.db.WithContext(ctx), "", "", "", currentQueryOptions{
		LiveOnly:            true,
		DetectorMarketsOnly: true,
		MinCollectedAt:      minCollectedAt,
	}).Find(&quotes).Error
	return quotes, err
}

type currentQueryOptions struct {
	LiveOnly            bool
	DetectorMarketsOnly bool
	MinCollectedAt      time.Time
}

func (r *OddsSnapshotRepository) listCurrentQuery(
	db *gorm.DB,
	bookmakerID, lobbyID, fixtureID string,
	options currentQueryOptions,
) *gorm.DB {
	subquery := buildLatestOddsSnapshotSubquery(
		applyOddsQuoteFilters(db.Table("odds_quotes"), "odds_quotes", bookmakerID, lobbyID, fixtureID),
		options,
	)

	return db.Table("(?) as odds_quotes", subquery).
		Order("odds_quotes.fixture_id asc, odds_quotes.market_id asc, odds_quotes.outcome_id asc")
}

func applyOddsQuoteFilters(db *gorm.DB, tableName, bookmakerID, lobbyID, fixtureID string) *gorm.DB {
	if bookmakerID != "" {
		db = db.Where(qualifiedColumn(tableName, "bookmaker_id")+" = ?", bookmakerID)
	}
	if lobbyID != "" {
		db = db.Where(qualifiedColumn(tableName, "lobby_id")+" = ?", lobbyID)
	}
	if fixtureID != "" {
		db = db.Where(qualifiedColumn(tableName, "fixture_id")+" = ?", fixtureID)
	}
	return db
}

func buildLatestOddsSnapshotSubquery(db *gorm.DB, options currentQueryOptions) *gorm.DB {
	if options.LiveOnly {
		db = db.
			Where("odds_quotes.suspended = ?", false).
			Where("odds_quotes.odds <> 0")
	}
	if options.DetectorMarketsOnly {
		db = db.Where(detectorMarketSQL("odds_quotes"))
	}
	if !options.MinCollectedAt.IsZero() {
		db = db.Where("odds_quotes.collected_at >= ?", options.MinCollectedAt.UTC())
	}

	fixtureKeyExpr := semanticFixtureColumn("odds_quotes", "home_team")
	opponentKeyExpr := semanticFixtureColumn("odds_quotes", "away_team")
	marketKeyExpr := semanticMarketColumn("odds_quotes")

	distinctOn := stringsJoinSQL(
		"odds_quotes.bookmaker_id",
		"odds_quotes.lobby_id",
		fixtureKeyExpr,
		opponentKeyExpr,
		marketKeyExpr,
		"odds_quotes.outcome_name",
	)
	orderBy := stringsJoinSQL(
		"odds_quotes.bookmaker_id asc",
		"odds_quotes.lobby_id asc",
		fixtureKeyExpr+" asc",
		opponentKeyExpr+" asc",
		marketKeyExpr+" asc",
		"odds_quotes.outcome_name asc",
		"odds_quotes.collected_at desc",
	)

	return db.
		Select(fmt.Sprintf("DISTINCT ON (%s) odds_quotes.*", distinctOn)).
		Order(orderBy)
}

func semanticFixtureColumn(tableName, teamColumn string) string {
	return fmt.Sprintf(
		"COALESCE(NULLIF(%s.%s, ''), %s.fixture_id)",
		tableName,
		teamColumn,
		tableName,
	)
}

func semanticMarketColumn(tableName string) string {
	return fmt.Sprintf(
		"COALESCE(NULLIF(%s.market_id, ''), %s.market_name)",
		tableName,
		tableName,
	)
}

func detectorMarketSQL(tableName string) string {
	column := qualifiedColumn(tableName, "market_id")
	return "(" +
		column + " ILIKE '%handicap%' OR " +
		column + " ILIKE '%cu-o-c-cha-p%' OR " +
		column + " ILIKE '%over-under%' OR " +
		column + " ILIKE '%ta-i-xi-u%' OR " +
		column + " ILIKE '%o-u%'" +
		")"
}

func stringsJoinSQL(parts ...string) string {
	if len(parts) == 0 {
		return ""
	}
	result := parts[0]
	for _, part := range parts[1:] {
		result += ", " + part
	}
	return result
}

func qualifiedColumn(tableName, column string) string {
	if tableName == "" {
		return column
	}
	return tableName + "." + column
}

func dedupeOddsQuotes(quotes []models.OddsQuote) []models.OddsQuote {
	if len(quotes) < 2 {
		return quotes
	}

	ordered := make([]models.OddsQuote, 0, len(quotes))
	indexByID := make(map[string]int, len(quotes))

	for _, quote := range quotes {
		if idx, exists := indexByID[quote.ID]; exists {
			ordered[idx] = pickMoreRecentQuote(ordered[idx], quote)
			continue
		}

		indexByID[quote.ID] = len(ordered)
		ordered = append(ordered, quote)
	}

	return ordered
}

func pickMoreRecentQuote(current, candidate models.OddsQuote) models.OddsQuote {
	switch {
	case candidate.CollectedAt.After(current.CollectedAt):
		return candidate
	case current.CollectedAt.After(candidate.CollectedAt):
		return current
	case candidate.Suspended && !current.Suspended:
		return candidate
	case candidate.AvailableStake > current.AvailableStake:
		return candidate
	case candidate.AvailableStake < current.AvailableStake:
		return current
	case candidate.Odds != current.Odds:
		return candidate
	default:
		return preferLaterNonZeroTime(current, candidate)
	}
}

func preferLaterNonZeroTime(current, candidate models.OddsQuote) models.OddsQuote {
	if current.CollectedAt.Equal(time.Time{}) && !candidate.CollectedAt.Equal(time.Time{}) {
		return candidate
	}
	return candidate
}
