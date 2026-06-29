package gormstore

import (
	"context"

	"gorm.io/gorm"

	"surebet/backend/internal/models"
)

type OddsSnapshotRepository struct {
	db *gorm.DB
}

func NewOddsSnapshotRepository(db *gorm.DB) *OddsSnapshotRepository {
	return &OddsSnapshotRepository{db: db}
}

func (r *OddsSnapshotRepository) Upsert(ctx context.Context, quotes []models.OddsQuote) error {
	if len(quotes) == 0 {
		return nil
	}

	for _, quote := range quotes {
		if err := r.db.WithContext(ctx).
			Where("id = ?", quote.ID).
			Assign(quote).
			FirstOrCreate(&models.OddsQuote{}).Error; err != nil {
			return err
		}
	}

	return nil
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
	query := r.db.WithContext(ctx).Model(&models.OddsQuote{}).Order("collected_at desc")

	if bookmakerID != "" {
		query = query.Where("bookmaker_id = ?", bookmakerID)
	}
	if lobbyID != "" {
		query = query.Where("lobby_id = ?", lobbyID)
	}
	if fixtureID != "" {
		query = query.Where("fixture_id = ?", fixtureID)
	}

	var quotes []models.OddsQuote
	err := query.Find(&quotes).Error
	return quotes, err
}
