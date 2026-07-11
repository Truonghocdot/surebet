package telegram

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"html"
	"net/http"
	"strings"
	"sync/atomic"
	"time"

	"github.com/google/uuid"

	"surebet/backend/internal/config"
	"surebet/backend/internal/dto"
	"surebet/backend/internal/logger"
	"surebet/backend/internal/models"
)

type SurebetReader interface {
	ListCurrentSurebets(ctx context.Context) ([]dto.SurebetView, error)
}

type RecipientReader interface {
	ListActive(ctx context.Context) ([]models.TelegramRecipient, error)
}

type NotificationLogWriter interface {
	HasRecentSent(ctx context.Context, recipientID uint64, opportunityID string, since time.Time) (bool, error)
	Create(ctx context.Context, log models.TelegramNotificationLog) error
}

type Notifier struct {
	cfg        config.TelegramConfig
	reader     SurebetReader
	recipients RecipientReader
	logs       NotificationLogWriter
	log        logger.Logger
	client     *http.Client
	running    atomic.Bool
	lastRunAt  atomic.Int64
}

func NewNotifier(
	cfg config.TelegramConfig,
	reader SurebetReader,
	recipients RecipientReader,
	logs NotificationLogWriter,
	log logger.Logger,
) *Notifier {
	if strings.TrimSpace(cfg.BotToken) == "" {
		return nil
	}

	timeout := cfg.RequestTimeout
	if timeout <= 0 {
		timeout = 10 * time.Second
	}

	return &Notifier{
		cfg:        cfg,
		reader:     reader,
		recipients: recipients,
		logs:       logs,
		log:        log,
		client:     &http.Client{Timeout: timeout},
	}
}

func (n *Notifier) Trigger() {
	if n == nil {
		return
	}

	now := time.Now().UTC()
	if cooldown := n.cfg.ScanCooldown; cooldown > 0 {
		lastRunAt := time.Unix(0, n.lastRunAt.Load())
		if !lastRunAt.IsZero() && now.Sub(lastRunAt) < cooldown {
			return
		}
	}

	if !n.running.CompareAndSwap(false, true) {
		return
	}
	n.lastRunAt.Store(now.UnixNano())

	go func() {
		defer n.running.Store(false)

		ctx, cancel := context.WithTimeout(context.Background(), n.client.Timeout+(5*time.Second))
		defer cancel()

		if err := n.notifyCurrentSurebets(ctx); err != nil {
			n.log.Warn("telegram surebet notification failed", "error", err.Error())
		}
	}()
}

func (n *Notifier) notifyCurrentSurebets(ctx context.Context) error {
	opportunities, err := n.reader.ListCurrentSurebets(ctx)
	if err != nil {
		return err
	}
	if len(opportunities) == 0 {
		return nil
	}

	recipients, err := n.recipients.ListActive(ctx)
	if err != nil {
		return err
	}
	if len(recipients) == 0 {
		return nil
	}

	since := time.Now().UTC().Add(-n.cfg.DedupWindow)
	for _, item := range opportunities {
		message := formatSurebetMessage(item)

		for _, recipient := range recipients {
			sent, err := n.logs.HasRecentSent(ctx, recipient.ID, item.ID, since)
			if err != nil {
				return err
			}
			if sent {
				continue
			}

			status := "sent"
			errorMessage := ""
			if err := n.sendMessage(ctx, recipient.ChatID, message); err != nil {
				status = "failed"
				errorMessage = err.Error()
				n.log.Warn(
					"telegram send failed",
					"recipient_id", recipient.ID,
					"chat_id", recipient.ChatID,
					"opportunity_id", item.ID,
					"error", err.Error(),
				)
			}

			if err := n.logs.Create(ctx, models.TelegramNotificationLog{
				ID:               uuid.NewString(),
				RecipientID:      recipient.ID,
				OpportunityID:    item.ID,
				FixtureID:        item.FixtureID,
				MarketName:       item.MarketName,
				ProfitPercentage: item.ProfitPercentage,
				Status:           status,
				ErrorMessage:     errorMessage,
				Message:          message,
				SentAt:           time.Now().UTC(),
				CreatedAt:        time.Now().UTC(),
				UpdatedAt:        time.Now().UTC(),
			}); err != nil {
				return err
			}
		}
	}

	return nil
}

func (n *Notifier) sendMessage(ctx context.Context, chatID, message string) error {
	endpoint := strings.TrimRight(n.cfg.APIBaseURL, "/") + "/bot" + n.cfg.BotToken + "/sendMessage"

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

	response, err := n.client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()

	if response.StatusCode >= http.StatusBadRequest {
		return fmt.Errorf("telegram api returned %s", response.Status)
	}

	return nil
}

func formatSurebetMessage(item dto.SurebetView) string {
	var builder strings.Builder

	builder.WriteString("<b>Surebet moi</b>\n")
	builder.WriteString("Tran: <b>")
	builder.WriteString(html.EscapeString(item.FixtureID))
	builder.WriteString("</b>\n")
	builder.WriteString("Thi truong: ")
	builder.WriteString(html.EscapeString(item.MarketName))
	builder.WriteString("\n")
	builder.WriteString(fmt.Sprintf("Loi nhuan: <b>%.2f%%</b>\n", item.ProfitPercentage))
	builder.WriteString(fmt.Sprintf("Ty suat ky vong: %.2f%%\n", item.ExpectedReturn*100))

	for index, leg := range item.Legs {
		builder.WriteString(fmt.Sprintf(
			"Cua %d: %s/%s - %s @ %.2f (%.2f%%)\n",
			index+1,
			html.EscapeString(leg.BookmakerID),
			html.EscapeString(leg.LobbyID),
			html.EscapeString(leg.OutcomeName),
			leg.Odds,
			leg.Stake*100,
		))
	}

	builder.WriteString("Phat hien: ")
	builder.WriteString(item.DetectedAt.Format(time.RFC3339))

	return builder.String()
}
