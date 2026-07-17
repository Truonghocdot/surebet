package surebet

import (
	"context"
	"fmt"
	"strings"
	"time"

	"surebet/backend/internal/calculator"
	"surebet/backend/internal/dto"
	"surebet/backend/internal/models"
)

const (
	confirmationTimeout = 2500 * time.Millisecond
	confirmationMaxAge  = 3 * time.Second
)

type CollectorQuoteConfirmer interface {
	ConfirmQuote(
		ctx context.Context,
		source dto.CollectorSource,
		fixtureID, marketID, outcomeID string,
	) (dto.CollectorConfirmQuoteResponse, error)
}

type CurrentSurebetReader interface {
	ListCurrentSurebets(ctx context.Context) ([]dto.SurebetView, error)
}

type ConfirmationService struct {
	current   CurrentSurebetReader
	confirmer CollectorQuoteConfirmer
	detector  calculator.Detector
}

func NewConfirmationService(
	current CurrentSurebetReader,
	confirmer CollectorQuoteConfirmer,
	detector calculator.Detector,
) *ConfirmationService {
	return &ConfirmationService{
		current:   current,
		confirmer: confirmer,
		detector:  detector,
	}
}

func (s *ConfirmationService) ConfirmCurrentSurebet(
	ctx context.Context,
	opportunityID string,
) (dto.SurebetView, bool, error) {
	if s == nil || s.current == nil || s.confirmer == nil || s.detector == nil {
		return dto.SurebetView{}, false, fmt.Errorf("surebet confirmation is not configured")
	}

	items, err := s.current.ListCurrentSurebets(ctx)
	if err != nil {
		return dto.SurebetView{}, false, err
	}
	var current dto.SurebetView
	found := false
	for _, item := range items {
		if item.ID == opportunityID {
			current = item
			found = true
			break
		}
	}
	if !found || len(current.Legs) != 2 {
		return dto.SurebetView{}, false, nil
	}

	confirmCtx, cancel := context.WithTimeout(ctx, confirmationTimeout)
	defer cancel()

	type confirmationResult struct {
		index    int
		response dto.CollectorConfirmQuoteResponse
		err      error
	}
	results := make(chan confirmationResult, len(current.Legs))
	for index, leg := range current.Legs {
		go func(index int, leg dto.SurebetLegView) {
			response, err := s.confirmer.ConfirmQuote(
				confirmCtx,
				collectorSourceForLeg(leg),
				leg.FixtureID,
				leg.MarketID,
				leg.OutcomeID,
			)
			results <- confirmationResult{index: index, response: response, err: err}
		}(index, leg)
	}

	confirmed := make([]dto.CollectorConfirmQuoteResponse, len(current.Legs))
	for range current.Legs {
		select {
		case <-confirmCtx.Done():
			return dto.SurebetView{}, false, confirmCtx.Err()
		case result := <-results:
			if result.err != nil {
				return dto.SurebetView{}, false, result.err
			}
			confirmed[result.index] = result.response
		}
	}

	now := time.Now().UTC()
	quotes := make([]models.OddsQuote, 0, len(confirmed))
	for index, response := range confirmed {
		quote, ok := confirmedQuoteToModel(current.Legs[index], response, now)
		if !ok {
			return dto.SurebetView{}, false, nil
		}
		quotes = append(quotes, quote)
	}

	opportunities, err := s.detector.Detect(ctx, quotes)
	if err != nil {
		return dto.SurebetView{}, false, err
	}
	if len(opportunities) == 0 {
		return dto.SurebetView{}, false, nil
	}

	result := mapOpportunity(opportunities[0])
	result.ID = current.ID
	result.FixtureID = current.FixtureID
	result.MarketName = current.MarketName
	return result, true, nil
}

func collectorSourceForLeg(leg dto.SurebetLegView) dto.CollectorSource {
	collectorID := leg.BookmakerID
	if leg.BookmakerID == "jun88" && leg.LobbyID == "cmd" {
		collectorID = "jun88-cmd"
	}
	return dto.CollectorSource{
		CollectorID: collectorID,
		BookmakerID: leg.BookmakerID,
		LobbyID:     leg.LobbyID,
	}
}

func confirmedQuoteToModel(
	leg dto.SurebetLegView,
	response dto.CollectorConfirmQuoteResponse,
	now time.Time,
) (models.OddsQuote, bool) {
	selection := response.Selection
	if !response.Found || selection == nil || selection.Suspended {
		return models.OddsQuote{}, false
	}
	if selection.FixtureID != leg.FixtureID ||
		selection.MarketID != leg.MarketID ||
		selection.OutcomeID != leg.OutcomeID {
		return models.OddsQuote{}, false
	}
	if response.ObservedAt.IsZero() {
		return models.OddsQuote{}, false
	}
	age := now.Sub(response.ObservedAt.UTC())
	if age < -time.Second || age > confirmationMaxAge {
		return models.OddsQuote{}, false
	}

	var eventStartAt *time.Time
	if parsed, err := time.Parse(time.RFC3339, strings.TrimSpace(selection.EventStartAt)); err == nil {
		parsed = parsed.UTC()
		eventStartAt = &parsed
	}

	return models.OddsQuote{
		ID:             leg.BookmakerID + "|" + leg.LobbyID + "|" + selection.OutcomeID,
		BookmakerID:    leg.BookmakerID,
		LobbyID:        leg.LobbyID,
		FixtureID:      selection.FixtureID,
		HomeTeam:       selection.HomeTeam,
		AwayTeam:       selection.AwayTeam,
		LeagueName:     selection.LeagueName,
		Sport:          selection.Sport,
		MarketID:       selection.MarketID,
		MarketName:     selection.MarketID,
		OutcomeID:      selection.OutcomeID,
		OutcomeName:    selection.OutcomeName,
		Odds:           selection.Odds,
		AvailableStake: selection.AvailableStake,
		Suspended:      selection.Suspended,
		MatchState:     selection.MatchState,
		EventStartAt:   eventStartAt,
		CollectedAt:    response.ObservedAt.UTC(),
		LastObservedAt: response.ObservedAt.UTC(),
		ChangedAt:      response.ObservedAt.UTC(),
	}, true
}
