package calculator

import (
	"context"

	"surebet/backend/internal/models"
)

type Detector interface {
	Detect(ctx context.Context, quotes []models.OddsQuote) ([]models.SurebetOpportunity, error)
}
