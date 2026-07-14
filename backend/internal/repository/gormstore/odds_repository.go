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
const defaultCurrentOddsWindow = 12 * time.Hour

var defaultDetectorSources = []detectorSource{
	{BookmakerID: "8xbet", LobbyID: "default"},
	{BookmakerID: "jun88", LobbyID: "bti"},
	{BookmakerID: "jun88", LobbyID: "saba"},
	{BookmakerID: "jun88", LobbyID: "cmd"},
	{BookmakerID: "jun88", LobbyID: "m9bet"},
}

type detectorSource struct {
	BookmakerID string
	LobbyID     string
}

func NewOddsSnapshotRepository(db *gorm.DB) *OddsSnapshotRepository {
	return &OddsSnapshotRepository{db: db}
}

func (r *OddsSnapshotRepository) Upsert(ctx context.Context, quotes []models.OddsQuote) error {
	if len(quotes) == 0 {
		return nil
	}

	quotes = dedupeOddsQuotes(quotes)

	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		return upsertOddsQuotes(tx, quotes)
	})
}

func (r *OddsSnapshotRepository) ReplaceSourceSnapshot(
	ctx context.Context,
	bookmakerID, lobbyID string,
	collectedAt time.Time,
	quotes []models.OddsQuote,
) error {
	if len(quotes) == 0 {
		return nil
	}

	quotes = dedupeOddsQuotes(quotes)
	collectedAt = collectedAt.UTC()

	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := upsertOddsQuotes(tx, quotes); err != nil {
			return err
		}

		quoteIDs := make([]string, 0, len(quotes))
		for _, quote := range quotes {
			quoteIDs = append(quoteIDs, quote.ID)
		}

		return suspendMissingSourceRowsQuery(tx, bookmakerID, lobbyID, collectedAt, quoteIDs).Updates(map[string]any{
			"suspended":    true,
			"collected_at": collectedAt,
		}).Error
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
	err := r.listCurrentQuery(r.db.WithContext(ctx), bookmakerID, lobbyID, fixtureID, currentQueryOptions{
		OnlyActiveMatches: true,
	}).
		Find(&quotes).Error
	return quotes, err
}

func (r *OddsSnapshotRepository) ListCurrentLive(
	ctx context.Context,
	bookmakerID, lobbyID, fixtureID string,
) ([]models.OddsQuote, error) {
	var quotes []models.OddsQuote
	err := r.listCurrentQuery(r.db.WithContext(ctx), bookmakerID, lobbyID, fixtureID, currentQueryOptions{
		LiveOnly:          true,
		OnlyActiveMatches: true,
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
		OnlyActiveMatches:   true,
	}).Find(&quotes).Error
	return quotes, err
}

func (r *OddsSnapshotRepository) ListCurrentDetectorCandidatesBySource(
	ctx context.Context,
	minCollectedAt time.Time,
) ([]models.OddsQuote, error) {
	result := make([]models.OddsQuote, 0)
	for _, source := range defaultDetectorSources {
		var quotes []models.OddsQuote
		err := r.listCurrentDetectorSourceQuery(
			r.db.WithContext(ctx),
			source,
			minCollectedAt,
		).Find(&quotes).Error
		if err != nil {
			return nil, err
		}
		result = append(result, quotes...)
	}
	return result, nil
}

type currentQueryOptions struct {
	LiveOnly            bool
	DetectorMarketsOnly bool
	MinCollectedAt      time.Time
	OnlyActiveMatches   bool
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

func (r *OddsSnapshotRepository) listCurrentDetectorSourceQuery(
	db *gorm.DB,
	source detectorSource,
	minCollectedAt time.Time,
) *gorm.DB {
	subquery := buildLatestOddsSnapshotSubquery(
		applyOddsQuoteFilters(
			db.Table("odds_quotes"),
			"odds_quotes",
			source.BookmakerID,
			source.LobbyID,
			"",
		),
		currentQueryOptions{
			LiveOnly:            true,
			DetectorMarketsOnly: true,
			MinCollectedAt:      minCollectedAt,
			OnlyActiveMatches:   true,
		},
	)

	return db.Table("(?) as odds_quotes", subquery)
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
	if options.OnlyActiveMatches {
		db = db.Where("odds_quotes.match_state IN ?", []string{"upcoming", "live", "unknown"})
	}
	if options.DetectorMarketsOnly {
		db = db.Where(detectorMarketSQL("odds_quotes"))
	}
	if !options.MinCollectedAt.IsZero() {
		db = db.Where("odds_quotes.collected_at >= ?", options.MinCollectedAt.UTC())
	} else if options.OnlyActiveMatches {
		db = db.Where("odds_quotes.collected_at >= ?", time.Now().UTC().Add(-defaultCurrentOddsWindow))
	}

	distinctOn := stringsJoinSQL(
		"odds_quotes.bookmaker_id",
		"odds_quotes.lobby_id",
		"odds_quotes.fixture_marker",
		"odds_quotes.market_marker",
		"odds_quotes.outcome_marker",
	)
	orderBy := stringsJoinSQL(
		"odds_quotes.bookmaker_id asc",
		"odds_quotes.lobby_id asc",
		"odds_quotes.fixture_marker asc",
		"odds_quotes.market_marker asc",
		"odds_quotes.outcome_marker asc",
		"odds_quotes.collected_at desc",
	)

	return db.
		Select(fmt.Sprintf("DISTINCT ON (%s) odds_quotes.*", distinctOn)).
		Order(orderBy)
}

func upsertOddsQuotes(db *gorm.DB, quotes []models.OddsQuote) error {
	return db.
		Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "id"}},
			DoUpdates: clause.Assignments(map[string]any{
				"bookmaker_id":    clause.Column{Name: "excluded.bookmaker_id"},
				"lobby_id":        clause.Column{Name: "excluded.lobby_id"},
				"fixture_id":      clause.Column{Name: "excluded.fixture_id"},
				"fixture_marker":  gorm.Expr("COALESCE(NULLIF(excluded.fixture_marker, ''), odds_quotes.fixture_marker)"),
				"home_team":       clause.Column{Name: "excluded.home_team"},
				"away_team":       clause.Column{Name: "excluded.away_team"},
				"league_name":     gorm.Expr("COALESCE(NULLIF(excluded.league_name, ''), odds_quotes.league_name)"),
				"sport":           clause.Column{Name: "excluded.sport"},
				"market_id":       clause.Column{Name: "excluded.market_id"},
				"market_marker":   gorm.Expr("COALESCE(NULLIF(excluded.market_marker, ''), odds_quotes.market_marker)"),
				"market_name":     clause.Column{Name: "excluded.market_name"},
				"outcome_id":      clause.Column{Name: "excluded.outcome_id"},
				"outcome_marker":  gorm.Expr("COALESCE(NULLIF(excluded.outcome_marker, ''), odds_quotes.outcome_marker)"),
				"outcome_name":    clause.Column{Name: "excluded.outcome_name"},
				"odds":            clause.Column{Name: "excluded.odds"},
				"available_stake": clause.Column{Name: "excluded.available_stake"},
				"suspended":       clause.Column{Name: "excluded.suspended"},
				"match_state":     gorm.Expr("COALESCE(NULLIF(excluded.match_state, ''), odds_quotes.match_state)"),
				"event_start_at":  gorm.Expr("COALESCE(excluded.event_start_at, odds_quotes.event_start_at)"),
				"collected_at":    clause.Column{Name: "excluded.collected_at"},
			}),
		}).
		CreateInBatches(&quotes, oddsUpsertBatchSize).Error
}

func suspendMissingSourceRowsQuery(
	db *gorm.DB,
	bookmakerID, lobbyID string,
	collectedAt time.Time,
	quoteIDs []string,
) *gorm.DB {
	query := db.
		Model(&models.OddsQuote{}).
		Where("bookmaker_id = ? AND lobby_id = ?", bookmakerID, lobbyID).
		Where("collected_at <= ?", collectedAt.UTC()).
		Where("suspended = ?", false)
	if len(quoteIDs) > 0 {
		query = query.Where("id NOT IN ?", quoteIDs)
	}
	return query
}

func detectorMarketSQL(tableName string) string {
	column := qualifiedColumn(tableName, "market_marker")
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
