package telegram

import (
	"context"
	"io"
	"testing"
	"time"

	"surebet/backend/internal/config"
	"surebet/backend/internal/dto"
	"surebet/backend/internal/logger"
	"surebet/backend/internal/models"
)

type notifierSurebetReaderStub struct {
	items []dto.SurebetView
}

func (s notifierSurebetReaderStub) ListCurrentSurebets(context.Context) ([]dto.SurebetView, error) {
	return append([]dto.SurebetView(nil), s.items...), nil
}

type notifierRecipientReaderStub struct {
	items []models.TelegramRecipient
}

func (s notifierRecipientReaderStub) ListActive(context.Context) ([]models.TelegramRecipient, error) {
	return append([]models.TelegramRecipient(nil), s.items...), nil
}

type notifierLogWriterStub struct {
	created []models.TelegramNotificationLog
}

func (s *notifierLogWriterStub) HasPendingOrRecentSent(context.Context, uint64, string, time.Time) (bool, error) {
	return false, nil
}

func (s *notifierLogWriterStub) Create(_ context.Context, log models.TelegramNotificationLog) error {
	s.created = append(s.created, log)
	return nil
}

func TestNotifierFiltersRecipientsByOddsProfile(t *testing.T) {
	mixedOpportunity := dto.SurebetView{
		ID:         "mixed-1",
		FixtureID:  "fixture-1",
		MarketName: "Handicap",
		Legs: []dto.SurebetLegView{
			{BookmakerID: "8xbet", LobbyID: "default", OutcomeID: "a", OutcomeName: "Home -0.5", Odds: -0.85},
			{BookmakerID: "jun88", LobbyID: "cmd", OutcomeID: "b", OutcomeName: "Away +0.5", Odds: 0.94},
		},
	}
	twoNegativeOpportunity := dto.SurebetView{
		ID:         "double-neg-1",
		FixtureID:  "fixture-2",
		MarketName: "Over/Under",
		Legs: []dto.SurebetLegView{
			{BookmakerID: "8xbet", LobbyID: "default", OutcomeID: "c", OutcomeName: "Over 2.5", Odds: -0.91},
			{BookmakerID: "jun88", LobbyID: "cmd", OutcomeID: "d", OutcomeName: "Under 2.5", Odds: -0.83},
		},
	}

	logs := &notifierLogWriterStub{}
	notifier := NewNotifier(
		config.TelegramConfig{
			BotToken:    "token",
			DedupWindow: 5 * time.Minute,
		},
		notifierSurebetReaderStub{
			items: []dto.SurebetView{mixedOpportunity, twoNegativeOpportunity},
		},
		notifierRecipientReaderStub{
			items: []models.TelegramRecipient{
				{
					ID:                             1,
					Name:                           "mixed-only",
					ChatID:                         "1",
					IsActive:                       true,
					ReceivesOneNegativeOnePositive: true,
					ReceivesTwoNegative:            false,
				},
				{
					ID:                             2,
					Name:                           "double-neg-only",
					ChatID:                         "2",
					IsActive:                       true,
					ReceivesOneNegativeOnePositive: false,
					ReceivesTwoNegative:            true,
				},
				{
					ID:                             3,
					Name:                           "both",
					ChatID:                         "3",
					IsActive:                       true,
					ReceivesOneNegativeOnePositive: true,
					ReceivesTwoNegative:            true,
				},
			},
		},
		logs,
		logger.NewStdLogger(io.Discard, "test"),
	)

	if notifier == nil {
		t.Fatal("expected notifier to be created")
	}

	if err := notifier.enqueueCurrentSurebets(context.Background()); err != nil {
		t.Fatalf("enqueue surebets: %v", err)
	}

	if len(logs.created) != 4 {
		t.Fatalf("expected 4 queued jobs, got %d", len(logs.created))
	}

	assertRecipientQueuedForOpportunity(t, logs.created, 1, "mixed-1", true)
	assertRecipientQueuedForOpportunity(t, logs.created, 1, "double-neg-1", false)
	assertRecipientQueuedForOpportunity(t, logs.created, 2, "mixed-1", false)
	assertRecipientQueuedForOpportunity(t, logs.created, 2, "double-neg-1", true)
	assertRecipientQueuedForOpportunity(t, logs.created, 3, "mixed-1", true)
	assertRecipientQueuedForOpportunity(t, logs.created, 3, "double-neg-1", true)
}

func assertRecipientQueuedForOpportunity(
	t *testing.T,
	items []models.TelegramNotificationLog,
	recipientID uint64,
	opportunityID string,
	want bool,
) {
	t.Helper()

	found := false
	for _, item := range items {
		if item.RecipientID == recipientID && item.OpportunityID == opportunityID {
			found = true
			break
		}
	}

	if found != want {
		t.Fatalf("expected queued=%t for recipient=%d opportunity=%s, got %t", want, recipientID, opportunityID, found)
	}
}
