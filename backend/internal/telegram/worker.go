package telegram

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"surebet/backend/internal/config"
	"surebet/backend/internal/dto"
	"surebet/backend/internal/logger"
	"surebet/backend/internal/models"
	"surebet/backend/internal/repository"
)

type RecipientLookup interface {
	GetByID(ctx context.Context, id uint64) (models.TelegramRecipient, error)
}

type NotificationQueue interface {
	ClaimPending(ctx context.Context, limit int) ([]models.TelegramNotificationLog, error)
	MarkSent(ctx context.Context, id string, sentAt time.Time) error
	RetryOrFail(ctx context.Context, job models.TelegramNotificationLog, errorMessage string, retryDelay time.Duration, maxAttempts int, attemptedAt time.Time) error
	MarkFailed(ctx context.Context, id string, errorMessage string, attemptedAt time.Time) error
	MarkExpired(ctx context.Context, id string, reason string, expiredAt time.Time) error
}

type Worker struct {
	cfg        config.TelegramConfig
	recipients RecipientLookup
	queue      NotificationQueue
	surebets   SurebetReader
	log        logger.Logger
	client     *http.Client
}

func NewWorker(
	cfg config.TelegramConfig,
	recipients RecipientLookup,
	queue NotificationQueue,
	surebets SurebetReader,
	log logger.Logger,
) *Worker {
	if strings.TrimSpace(cfg.BotToken) == "" {
		return nil
	}

	timeout := cfg.RequestTimeout
	if timeout <= 0 {
		timeout = 10 * time.Second
	}

	return &Worker{
		cfg:        cfg,
		recipients: recipients,
		queue:      queue,
		surebets:   surebets,
		log:        log,
		client:     &http.Client{Timeout: timeout},
	}
}

func (w *Worker) Run(ctx context.Context) error {
	if w == nil {
		<-ctx.Done()
		return nil
	}

	pollInterval := w.cfg.QueuePollInterval
	if pollInterval <= 0 {
		pollInterval = 250 * time.Millisecond
	}

	batchSize := w.cfg.QueueBatchSize
	if batchSize <= 0 {
		batchSize = 25
	}

	timer := time.NewTimer(0)
	defer timer.Stop()

	for {
		select {
		case <-ctx.Done():
			return nil
		case <-timer.C:
			if err := w.processBatch(ctx, batchSize); err != nil {
				w.log.Warn("telegram queue batch failed", "error", err.Error())
			}
			timer.Reset(pollInterval)
		}
	}
}

func (w *Worker) processBatch(ctx context.Context, batchSize int) error {
	jobs, err := w.queue.ClaimPending(ctx, batchSize)
	if err != nil {
		return err
	}
	if len(jobs) == 0 {
		return nil
	}

	for _, job := range jobs {
		attemptedAt := time.Now().UTC()
		if w.surebets == nil {
			_ = w.queue.RetryOrFail(
				ctx,
				job,
				"surebet revalidation is not configured",
				w.cfg.QueueRetryDelay,
				w.cfg.QueueMaxAttempts,
				attemptedAt,
			)
			continue
		}

		currentSurebets, err := w.surebets.ListCurrentSurebets(ctx)
		if err != nil {
			_ = w.queue.RetryOrFail(
				ctx,
				job,
				"surebet revalidation failed: "+err.Error(),
				w.cfg.QueueRetryDelay,
				w.cfg.QueueMaxAttempts,
				attemptedAt,
			)
			continue
		}

		var current dto.SurebetView
		stillActive := false
		for _, item := range currentSurebets {
			if item.ID != job.OpportunityID {
				continue
			}
			current = item
			stillActive = true
			break
		}
		if !stillActive || (!current.ExpiresAt.IsZero() && !current.ExpiresAt.After(attemptedAt)) {
			_ = w.queue.MarkExpired(ctx, job.ID, "surebet is no longer active", attemptedAt)
			w.log.Info("telegram notification expired before send", "opportunity_id", job.OpportunityID)
			continue
		}
		recipient, err := w.recipients.GetByID(ctx, job.RecipientID)
		if err != nil {
			if err == repository.ErrNotFound {
				_ = w.queue.MarkFailed(ctx, job.ID, "recipient not found", attemptedAt)
				continue
			}
			_ = w.queue.RetryOrFail(ctx, job, "recipient lookup failed: "+err.Error(), w.cfg.QueueRetryDelay, w.cfg.QueueMaxAttempts, attemptedAt)
			continue
		}

		if !recipient.IsActive {
			_ = w.queue.MarkFailed(ctx, job.ID, "recipient is inactive", attemptedAt)
			continue
		}
		if strings.TrimSpace(recipient.ChatID) == "" {
			_ = w.queue.MarkFailed(ctx, job.ID, "recipient chat_id is empty", attemptedAt)
			continue
		}
		if !recipientAcceptsOpportunity(recipient, current) {
			_ = w.queue.MarkExpired(ctx, job.ID, "recipient no longer accepts this odds profile", attemptedAt)
			continue
		}

		if err := w.sendMessage(ctx, recipient.ChatID, formatSurebetMessage(current)); err != nil {
			_ = w.queue.RetryOrFail(ctx, job, err.Error(), w.cfg.QueueRetryDelay, w.cfg.QueueMaxAttempts, attemptedAt)
			w.log.Warn(
				"telegram send failed",
				"recipient_id", recipient.ID,
				"chat_id", recipient.ChatID,
				"opportunity_id", job.OpportunityID,
				"attempt_count", job.AttemptCount,
				"error", err.Error(),
			)
			continue
		}

		if err := w.queue.MarkSent(ctx, job.ID, attemptedAt); err != nil {
			return err
		}
	}

	return nil
}

func (w *Worker) sendMessage(ctx context.Context, chatID, message string) error {
	endpoint := strings.TrimRight(w.cfg.APIBaseURL, "/") + "/bot" + w.cfg.BotToken + "/sendMessage"

	body, err := json.Marshal(map[string]any{
		"chat_id":                  chatID,
		"text":                     message,
		"parse_mode":               "HTML",
		"disable_web_page_preview": true,
	})
	if err != nil {
		return err
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")

	response, err := w.client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()

	if response.StatusCode >= http.StatusBadRequest {
		return fmt.Errorf("telegram api returned %s", response.Status)
	}

	return nil
}
