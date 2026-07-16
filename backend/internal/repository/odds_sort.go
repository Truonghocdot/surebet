package repository

import (
	"sort"

	"surebet/backend/internal/models"
)

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
