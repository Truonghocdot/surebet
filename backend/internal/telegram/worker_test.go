package telegram

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"surebet/backend/internal/config"
	"surebet/backend/internal/dto"
	"surebet/backend/internal/logger"
	"surebet/backend/internal/models"
)

func TestWorkerRevalidatesAndFormatsCurrentSurebetBeforeSend(t *testing.T) {
	var sentMessage string
	telegramServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		body, err := io.ReadAll(request.Body)
		if err != nil {
			t.Fatalf("read telegram body: %v", err)
		}
		sentMessage = string(body)
		writer.WriteHeader(http.StatusOK)
	}))
	defer telegramServer.Close()

	current := workerTestSurebet("opportunity-a", -0.92, 0.96)
	queue := &workerQueueStub{jobs: []models.TelegramNotificationLog{{
		ID:            "job-a",
		RecipientID:   7,
		OpportunityID: current.ID,
		Message:       "old odds -0.50 / 0.80",
	}}}
	worker := NewWorker(
		config.TelegramConfig{
			BotToken:          "token",
			APIBaseURL:        telegramServer.URL,
			RequestTimeout:    time.Second,
			QueueRetryDelay:   time.Second,
			QueueMaxAttempts:  3,
			QueuePollInterval: time.Second,
		},
		workerRecipientStub{recipient: workerTestRecipient()},
		queue,
		workerSurebetReaderStub{item: current, confirmed: true},
		logger.NewStdLogger(io.Discard, "test"),
	)

	if err := worker.processBatch(context.Background(), 1); err != nil {
		t.Fatalf("process batch: %v", err)
	}
	if len(queue.sent) != 1 || queue.sent[0] != "job-a" {
		t.Fatalf("expected current job to be sent, got %+v", queue.sent)
	}
	if strings.Contains(sentMessage, "-0.50") || !strings.Contains(sentMessage, "-0.92") {
		t.Fatalf("expected current odds in Telegram body, got %s", sentMessage)
	}
}

func TestBackendSurebetReaderLoadsCurrentBackendState(t *testing.T) {
	expected := workerTestSurebet("opportunity-reader", -0.8, 0.9)
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/v1/surebets" {
			t.Fatalf("unexpected backend path: %s", request.URL.Path)
		}
		if err := json.NewEncoder(writer).Encode(map[string]any{"data": []dto.SurebetView{expected}}); err != nil {
			t.Fatalf("write backend response: %v", err)
		}
	}))
	defer server.Close()

	reader := NewBackendSurebetReader(server.URL, time.Second)
	items, err := reader.ListCurrentSurebets(context.Background())
	if err != nil {
		t.Fatalf("load backend surebets: %v", err)
	}
	if len(items) != 1 || items[0].ID != expected.ID || items[0].Legs[0].Odds != expected.Legs[0].Odds {
		t.Fatalf("unexpected backend surebets: %+v", items)
	}
}

func TestBackendSurebetReaderConfirmsThroughInternalEndpoint(t *testing.T) {
	expected := workerTestSurebet("opportunity-confirmed", -0.8, 0.9)
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost {
			t.Fatalf("unexpected backend method: %s", request.Method)
		}
		if request.URL.Path != "/v2/internal/surebets/opportunity-confirmed/confirm" {
			t.Fatalf("unexpected backend path: %s", request.URL.Path)
		}
		if request.Header.Get("X-Surebet-Internal-Token") != "internal-token" {
			t.Fatal("missing internal confirmation token")
		}
		if err := json.NewEncoder(writer).Encode(map[string]any{"data": expected}); err != nil {
			t.Fatalf("write backend response: %v", err)
		}
	}))
	defer server.Close()

	reader := NewBackendSurebetConfirmer(server.URL, "internal-token", time.Second)
	item, confirmed, err := reader.ConfirmSurebet(context.Background(), expected.ID)
	if err != nil {
		t.Fatalf("confirm backend surebet: %v", err)
	}
	if !confirmed || item.ID != expected.ID || item.Legs[0].Odds != expected.Legs[0].Odds {
		t.Fatalf("unexpected confirmed surebet: confirmed=%t item=%+v", confirmed, item)
	}
}

func TestWorkerExpiresSurebetThatNoLongerExists(t *testing.T) {
	queue := &workerQueueStub{jobs: []models.TelegramNotificationLog{{
		ID:            "job-expired",
		RecipientID:   7,
		OpportunityID: "opportunity-missing",
		Message:       "stale message",
	}}}
	worker := NewWorker(
		config.TelegramConfig{BotToken: "token"},
		workerRecipientStub{recipient: workerTestRecipient()},
		queue,
		workerSurebetReaderStub{},
		logger.NewStdLogger(io.Discard, "test"),
	)

	if err := worker.processBatch(context.Background(), 1); err != nil {
		t.Fatalf("process batch: %v", err)
	}
	if len(queue.expired) != 1 || queue.expired[0] != "job-expired" {
		t.Fatalf("expected stale job to expire, got %+v", queue.expired)
	}
	if len(queue.sent) != 0 {
		t.Fatalf("stale job must not be sent, got %+v", queue.sent)
	}
}

func TestWorkerExpiresInsteadOfRetryingWhenConfirmationFails(t *testing.T) {
	queue := &workerQueueStub{jobs: []models.TelegramNotificationLog{{
		ID:            "job-confirmation-failed",
		RecipientID:   7,
		OpportunityID: "opportunity-a",
	}}}
	worker := NewWorker(
		config.TelegramConfig{BotToken: "token"},
		workerRecipientStub{recipient: workerTestRecipient()},
		queue,
		workerSurebetReaderStub{err: context.DeadlineExceeded},
		logger.NewStdLogger(io.Discard, "test"),
	)

	if err := worker.processBatch(context.Background(), 1); err != nil {
		t.Fatalf("process batch: %v", err)
	}
	if len(queue.expired) != 1 || queue.expired[0] != "job-confirmation-failed" {
		t.Fatalf("expected failed confirmation job to expire, got %+v", queue.expired)
	}
	if len(queue.sent) != 0 {
		t.Fatalf("failed confirmation job must not be sent, got %+v", queue.sent)
	}
}

func TestWorkerExpiresSurebetPastItsExpiryBeforeSend(t *testing.T) {
	current := workerTestSurebet("opportunity-expired", -0.92, 0.96)
	current.ExpiresAt = time.Now().UTC().Add(-time.Second)
	queue := &workerQueueStub{jobs: []models.TelegramNotificationLog{{
		ID:            "job-expired-by-time",
		RecipientID:   7,
		OpportunityID: current.ID,
	}}}
	worker := NewWorker(
		config.TelegramConfig{BotToken: "token"},
		workerRecipientStub{recipient: workerTestRecipient()},
		queue,
		workerSurebetReaderStub{item: current, confirmed: true},
		logger.NewStdLogger(io.Discard, "test"),
	)

	if err := worker.processBatch(context.Background(), 1); err != nil {
		t.Fatalf("process batch: %v", err)
	}
	if len(queue.expired) != 1 || queue.expired[0] != "job-expired-by-time" {
		t.Fatalf("expected time-expired job to expire, got %+v", queue.expired)
	}
	if len(queue.sent) != 0 {
		t.Fatalf("expired job must not be sent, got %+v", queue.sent)
	}
}

type workerQueueStub struct {
	jobs    []models.TelegramNotificationLog
	sent    []string
	expired []string
}

func (s *workerQueueStub) ClaimPending(context.Context, int) ([]models.TelegramNotificationLog, error) {
	return append([]models.TelegramNotificationLog(nil), s.jobs...), nil
}

func (s *workerQueueStub) MarkSent(_ context.Context, id string, _ time.Time) error {
	s.sent = append(s.sent, id)
	return nil
}

func (s *workerQueueStub) RetryOrFail(context.Context, models.TelegramNotificationLog, string, time.Duration, int, time.Time) error {
	return nil
}

func (s *workerQueueStub) MarkFailed(context.Context, string, string, time.Time) error {
	return nil
}

func (s *workerQueueStub) MarkExpired(_ context.Context, id string, _ string, _ time.Time) error {
	s.expired = append(s.expired, id)
	return nil
}

type workerRecipientStub struct {
	recipient models.TelegramRecipient
}

func (s workerRecipientStub) GetByID(context.Context, uint64) (models.TelegramRecipient, error) {
	return s.recipient, nil
}

type workerSurebetReaderStub struct {
	item      dto.SurebetView
	confirmed bool
	err       error
}

func (s workerSurebetReaderStub) ConfirmSurebet(context.Context, string) (dto.SurebetView, bool, error) {
	return s.item, s.confirmed, s.err
}

func workerTestRecipient() models.TelegramRecipient {
	return models.TelegramRecipient{
		ID:                             7,
		ChatID:                         "7",
		IsActive:                       true,
		ReceivesOneNegativeOnePositive: true,
		ReceivesTwoNegative:            true,
	}
}

func workerTestSurebet(id string, leftOdds, rightOdds float64) dto.SurebetView {
	now := time.Now().UTC()
	return dto.SurebetView{
		ID:               id,
		FixtureID:        "Team A vs Team B",
		MarketName:       "Handicap",
		ProfitPercentage: 2.3,
		ExpectedReturn:   0.023,
		DetectedAt:       now,
		ExpiresAt:        now.Add(time.Minute),
		Legs: []dto.SurebetLegView{
			{BookmakerID: "8xbet", LobbyID: "default", OutcomeName: "Team A +0.5", Odds: leftOdds, Stake: 0.5},
			{BookmakerID: "jun88", LobbyID: "cmd", OutcomeName: "Team B -0.5", Odds: rightOdds, Stake: 0.5},
		},
	}
}
