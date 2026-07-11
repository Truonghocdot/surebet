package telegram

import (
	"context"
	"fmt"
	"html"
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
	HasPendingOrRecentSent(ctx context.Context, recipientID uint64, opportunityID string, since time.Time) (bool, error)
	Create(ctx context.Context, log models.TelegramNotificationLog) error
}

type Notifier struct {
	cfg        config.TelegramConfig
	reader     SurebetReader
	recipients RecipientReader
	logs       NotificationLogWriter
	log        logger.Logger
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

	return &Notifier{
		cfg:        cfg,
		reader:     reader,
		recipients: recipients,
		logs:       logs,
		log:        log,
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

		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()

		if err := n.enqueueCurrentSurebets(ctx); err != nil {
			n.log.Warn("telegram surebet enqueue failed", "error", err.Error())
		}
	}()
}

func (n *Notifier) enqueueCurrentSurebets(ctx context.Context) error {
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
	queuedCount := 0

	for _, item := range opportunities {
		message := formatSurebetMessage(item)

		for _, recipient := range recipients {
			queuedOrSent, err := n.logs.HasPendingOrRecentSent(ctx, recipient.ID, item.ID, since)
			if err != nil {
				return err
			}
			if queuedOrSent {
				continue
			}

			now := time.Now().UTC()
			if err := n.logs.Create(ctx, models.TelegramNotificationLog{
				ID:               uuid.NewString(),
				RecipientID:      recipient.ID,
				OpportunityID:    item.ID,
				FixtureID:        item.FixtureID,
				MarketName:       item.MarketName,
				ProfitPercentage: item.ProfitPercentage,
				Status:           "pending",
				AttemptCount:     0,
				ErrorMessage:     "",
				Message:          message,
				AvailableAt:      &now,
				ReservedAt:       nil,
				SentAt:           now,
				CreatedAt:        now,
				UpdatedAt:        now,
			}); err != nil {
				return err
			}

			queuedCount += 1
		}
	}

	if queuedCount > 0 {
		n.log.Info("telegram surebet queued", "jobs", queuedCount)
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
