package gormstore

import (
	"context"
	"strings"
	"testing"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"

	"surebet/backend/internal/models"
	"surebet/backend/internal/repository"
)

func TestOddsSnapshotRepositoryListCurrentUsesSnapshotQuery(t *testing.T) {
	db, err := gorm.Open(
		postgres.Open("host=localhost user=surebet password=surebet dbname=surebet sslmode=disable"),
		&gorm.Config{
			DryRun:               true,
			DisableAutomaticPing: true,
		},
	)
	if err != nil {
		t.Fatalf("open dry-run db: %v", err)
	}

	repo := NewOddsSnapshotRepository(db)
	sql := db.ToSQL(func(tx *gorm.DB) *gorm.DB {
		query := repo.listCurrentQuery(
			tx.WithContext(context.Background()),
			"book-a",
			"lobby-a",
			"fixture-a",
			currentQueryOptions{},
		)
		return query.Find(&[]models.OddsQuote{})
	})

	if !strings.Contains(sql, "DISTINCT ON") {
		t.Fatalf("expected current snapshot query to use DISTINCT ON snapshot selection, got SQL: %s", sql)
	}
	if !strings.Contains(sql, "odds_quotes.bookmaker_id") {
		t.Fatalf("expected filters to be applied to snapshot query, got SQL: %s", sql)
	}
	if !strings.Contains(sql, "ORDER BY odds_quotes.fixture_id asc, odds_quotes.market_id asc, odds_quotes.outcome_id asc") {
		t.Fatalf("expected stable surebet ordering, got SQL: %s", sql)
	}
}

func TestOddsSnapshotRepositoryListCurrentLiveFiltersSuspendedAndZeroOdds(t *testing.T) {
	db, err := gorm.Open(
		postgres.Open("host=localhost user=surebet password=surebet dbname=surebet sslmode=disable"),
		&gorm.Config{
			DryRun:               true,
			DisableAutomaticPing: true,
		},
	)
	if err != nil {
		t.Fatalf("open dry-run db: %v", err)
	}

	repo := NewOddsSnapshotRepository(db)
	sql := db.ToSQL(func(tx *gorm.DB) *gorm.DB {
		query := repo.listCurrentQuery(
			tx.WithContext(context.Background()),
			"",
			"",
			"",
			currentQueryOptions{LiveOnly: true},
		)
		return query.Find(&[]models.OddsQuote{})
	})

	if !strings.Contains(sql, "odds_quotes.suspended = false") {
		t.Fatalf("expected live query to exclude suspended rows, got SQL: %s", sql)
	}
	if !strings.Contains(sql, "odds_quotes.odds <> 0") {
		t.Fatalf("expected live query to exclude zero odds rows, got SQL: %s", sql)
	}
}

func TestOddsSnapshotRepositoryDetectorQueryFiltersSupportedMarkets(t *testing.T) {
	db, err := gorm.Open(
		postgres.Open("host=localhost user=surebet password=surebet dbname=surebet sslmode=disable"),
		&gorm.Config{
			DryRun:               true,
			DisableAutomaticPing: true,
		},
	)
	if err != nil {
		t.Fatalf("open dry-run db: %v", err)
	}

	repo := NewOddsSnapshotRepository(db)
	sql := db.ToSQL(func(tx *gorm.DB) *gorm.DB {
		query := repo.listCurrentQuery(
			tx.WithContext(context.Background()),
			"",
			"",
			"",
			currentQueryOptions{
				LiveOnly:            true,
				DetectorMarketsOnly: true,
				MinCollectedAt:      time.Date(2026, 7, 1, 15, 0, 0, 0, time.UTC),
			},
		)
		return query.Find(&[]models.OddsQuote{})
	})

	if !strings.Contains(sql, "ILIKE '%handicap%'") || !strings.Contains(sql, "ILIKE '%ta-i-xi-u%'") {
		t.Fatalf("expected detector query to filter supported markets, got SQL: %s", sql)
	}
	if !strings.Contains(sql, "odds_quotes.collected_at >=") {
		t.Fatalf("expected detector query to apply freshness cutoff, got SQL: %s", sql)
	}
}

func TestOddsSnapshotRepositoryDetectorSourceQueryFiltersSingleSource(t *testing.T) {
	db, err := gorm.Open(
		postgres.Open("host=localhost user=surebet password=surebet dbname=surebet sslmode=disable"),
		&gorm.Config{
			DryRun:               true,
			DisableAutomaticPing: true,
		},
	)
	if err != nil {
		t.Fatalf("open dry-run db: %v", err)
	}

	repo := NewOddsSnapshotRepository(db)
	sql := db.ToSQL(func(tx *gorm.DB) *gorm.DB {
		query := repo.listCurrentDetectorSourceQuery(
			tx.WithContext(context.Background()),
			repository.OddsSource{BookmakerID: "8xbet", LobbyID: "default"},
			time.Date(2026, 7, 1, 15, 0, 0, 0, time.UTC),
		)
		return query.Find(&[]models.OddsQuote{})
	})

	if !strings.Contains(sql, "odds_quotes.bookmaker_id = '8xbet'") {
		t.Fatalf("expected detector source query to filter bookmaker, got SQL: %s", sql)
	}
	if !strings.Contains(sql, "odds_quotes.lobby_id = 'default'") {
		t.Fatalf("expected detector source query to filter lobby, got SQL: %s", sql)
	}
	if !strings.Contains(sql, "ILIKE '%handicap%'") || !strings.Contains(sql, "odds_quotes.collected_at >=") {
		t.Fatalf("expected detector source query to keep detector filters, got SQL: %s", sql)
	}
	if strings.Contains(sql, "ORDER BY odds_quotes.fixture_id asc") {
		t.Fatalf("expected detector source query to avoid outer display ordering, got SQL: %s", sql)
	}
}

func TestOddsSnapshotRepositoryReplaceSourceSnapshotSuspendsMissingRows(t *testing.T) {
	db, err := gorm.Open(
		postgres.Open("host=localhost user=surebet password=surebet dbname=surebet sslmode=disable"),
		&gorm.Config{
			DryRun:               true,
			DisableAutomaticPing: true,
		},
	)
	if err != nil {
		t.Fatalf("open dry-run db: %v", err)
	}

	collectedAt := time.Date(2026, 7, 14, 15, 0, 0, 0, time.UTC)
	sql := db.ToSQL(func(tx *gorm.DB) *gorm.DB {
		return suspendMissingSourceRowsQuery(
			tx.WithContext(context.Background()),
			"8xbet",
			"default",
			collectedAt,
			[]string{"quote-a"},
		).Updates(map[string]any{
			"suspended":    true,
			"collected_at": collectedAt,
		})
	})

	if !strings.Contains(sql, "UPDATE \"odds_quotes\"") {
		t.Fatalf("expected replace snapshot to suspend missing rows, got SQL: %s", sql)
	}
	if !strings.Contains(sql, "bookmaker_id = '8xbet'") || !strings.Contains(sql, "lobby_id = 'default'") {
		t.Fatalf("expected replace snapshot to scope suspension to source, got SQL: %s", sql)
	}
	if !strings.Contains(sql, "id NOT IN ('quote-a')") {
		t.Fatalf("expected replace snapshot to preserve current snapshot ids, got SQL: %s", sql)
	}
	if !strings.Contains(sql, "\"suspended\"=true") && !strings.Contains(sql, "\"suspended\" = true") {
		t.Fatalf("expected replace snapshot to update suspended state, got SQL: %s", sql)
	}
}

func TestDedupeOddsQuotesKeepsLatestQuotePerID(t *testing.T) {
	older := time.Date(2026, 6, 30, 11, 0, 0, 0, time.UTC)
	newer := older.Add(5 * time.Second)

	items := dedupeOddsQuotes([]models.OddsQuote{
		{
			ID:             "same-id",
			Odds:           1.8,
			AvailableStake: 100,
			Suspended:      false,
			CollectedAt:    older,
		},
		{
			ID:             "same-id",
			Odds:           1.9,
			AvailableStake: 120,
			Suspended:      true,
			CollectedAt:    newer,
		},
		{
			ID:             "other-id",
			Odds:           2.1,
			AvailableStake: 90,
			CollectedAt:    older,
		},
	})

	if len(items) != 2 {
		t.Fatalf("expected 2 unique items, got %d", len(items))
	}
	if items[0].ID != "same-id" {
		t.Fatalf("expected first quote to preserve original position, got %s", items[0].ID)
	}
	if !items[0].CollectedAt.Equal(newer) {
		t.Fatalf("expected latest quote to win, got %s", items[0].CollectedAt)
	}
	if !items[0].Suspended {
		t.Fatalf("expected latest suspended state to be retained")
	}
	if items[0].Odds != 1.9 {
		t.Fatalf("expected latest odds to be retained, got %f", items[0].Odds)
	}
}
