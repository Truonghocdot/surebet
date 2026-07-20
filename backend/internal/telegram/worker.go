package telegram

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
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
	MarkFailed(ctx context.Context, id string, errorMessage string, attemptedAt time.Time) error
	MarkExpired(ctx context.Context, id string, reason string, expiredAt time.Time) error
}

type VerifiedSurebetReader interface {
	GetVerifiedSurebet(ctx context.Context, opportunityID string) (dto.SurebetView, bool, error)
}

type Worker struct {
	cfg        config.TelegramConfig
	recipients RecipientLookup
	queue      NotificationQueue
	surebets   VerifiedSurebetReader
	log        logger.Logger
	client     *http.Client
}

func NewWorker(
	cfg config.TelegramConfig,
	recipients RecipientLookup,
	queue NotificationQueue,
	surebets VerifiedSurebetReader,
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

	semaphore := make(chan struct{}, 4)
	errors := make(chan error, len(jobs))
	var wait sync.WaitGroup
	for _, job := range jobs {
		job := job
		wait.Add(1)
		go func() {
			defer wait.Done()
			select {
			case semaphore <- struct{}{}:
				defer func() { <-semaphore }()
			case <-ctx.Done():
				errors <- ctx.Err()
				return
			}
			if err := w.processJob(ctx, job); err != nil {
				errors <- err
			}
		}()
	}
	wait.Wait()
	close(errors)
	for err := range errors {
		if err != nil {
			return err
		}
	}
	return nil
}

func (w *Worker) processJob(ctx context.Context, job models.TelegramNotificationLog) error {
	attemptedAt := time.Now().UTC()
	if w.surebets == nil {
		return w.queue.MarkExpired(ctx, job.ID, "verified surebet reader is not configured", attemptedAt)
	}

	current, confirmed, err := w.surebets.GetVerifiedSurebet(ctx, job.OpportunityID)
	if err != nil {
		_ = w.queue.MarkExpired(ctx, job.ID, "verified surebet lookup failed: "+err.Error(), attemptedAt)
		w.log.Warn("telegram verified surebet lookup failed", "opportunity_id", job.OpportunityID, "error", err.Error())
		return nil
	}
	if !confirmed || current.VerificationStatus != "confirmed" ||
		(!current.ValidUntil.IsZero() && !current.ValidUntil.After(attemptedAt)) {
		_ = w.queue.MarkExpired(ctx, job.ID, "verified surebet expired before send", attemptedAt)
		return nil
	}

	recipient, err := w.recipients.GetByID(ctx, job.RecipientID)
	if err != nil {
		if err == repository.ErrNotFound {
			return w.queue.MarkFailed(ctx, job.ID, "recipient not found", attemptedAt)
		}
		return w.queue.MarkFailed(ctx, job.ID, "recipient lookup failed: "+err.Error(), attemptedAt)
	}
	if !recipient.IsActive {
		return w.queue.MarkFailed(ctx, job.ID, "recipient is inactive", attemptedAt)
	}
	if strings.TrimSpace(recipient.ChatID) == "" {
		return w.queue.MarkFailed(ctx, job.ID, "recipient chat_id is empty", attemptedAt)
	}
	if !recipientAcceptsOpportunity(recipient, current) {
		return w.queue.MarkExpired(ctx, job.ID, "recipient no longer accepts this odds profile", attemptedAt)
	}
	if !current.ValidUntil.IsZero() && !current.ValidUntil.After(time.Now().UTC()) {
		return w.queue.MarkExpired(ctx, job.ID, "verified surebet expired before send", time.Now().UTC())
	}

	sendCtx := ctx
	cancel := func() {}
	if !current.ValidUntil.IsZero() {
		sendCtx, cancel = context.WithDeadline(ctx, current.ValidUntil)
	}
	err = w.sendMessage(sendCtx, recipient.ChatID, formatSurebetMessage(current))
	cancel()
	if err != nil {
		if !current.ValidUntil.IsZero() && !current.ValidUntil.After(time.Now().UTC()) {
			_ = w.queue.MarkExpired(ctx, job.ID, "verified surebet expired during send", time.Now().UTC())
			return nil
		}
		_ = w.queue.MarkFailed(ctx, job.ID, err.Error(), attemptedAt)
		w.log.Warn(
			"telegram send failed",
			"recipient_id", recipient.ID,
			"chat_id", recipient.ChatID,
			"opportunity_id", job.OpportunityID,
			"error", err.Error(),
		)
		return nil
	}
	return w.queue.MarkSent(ctx, job.ID, time.Now().UTC())
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
