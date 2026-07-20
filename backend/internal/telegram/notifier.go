package telegram

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"

	"surebet/backend/internal/config"
	"surebet/backend/internal/dto"
	"surebet/backend/internal/logger"
	"surebet/backend/internal/models"
)

type opportunityOddsProfile string

const (
	opportunityOddsProfileUnknown                opportunityOddsProfile = "unknown"
	opportunityOddsProfileOneNegativeOnePositive opportunityOddsProfile = "one_negative_one_positive"
	opportunityOddsProfileTwoNegative            opportunityOddsProfile = "two_negative"
)

type RecipientReader interface {
	ListActive(ctx context.Context) ([]models.TelegramRecipient, error)
}

type NotificationLogWriter interface {
	HasPendingOrRecentSent(ctx context.Context, recipientID uint64, opportunityID string, since time.Time) (bool, error)
	Create(ctx context.Context, log models.TelegramNotificationLog) error
}

type Notifier struct {
	cfg        config.TelegramConfig
	recipients RecipientReader
	logs       NotificationLogWriter
	log        logger.Logger
}

func NewNotifier(
	cfg config.TelegramConfig,
	recipients RecipientReader,
	logs NotificationLogWriter,
	log logger.Logger,
) *Notifier {
	if strings.TrimSpace(cfg.BotToken) == "" {
		return nil
	}

	return &Notifier{
		cfg:        cfg,
		recipients: recipients,
		logs:       logs,
		log:        log,
	}
}

func (n *Notifier) NotifyConfirmed(ctx context.Context, item dto.SurebetView) error {
	if n == nil || item.VerificationStatus != "confirmed" ||
		(!item.ValidUntil.IsZero() && !item.ValidUntil.After(time.Now().UTC())) {
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

	message := formatSurebetMessage(item)
	for _, recipient := range recipients {
		if !recipientAcceptsOpportunity(recipient, item) {
			continue
		}

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

	if queuedCount > 0 {
		n.log.Info("telegram surebet queued", "jobs", queuedCount)
	}

	return nil
}

func recipientAcceptsOpportunity(recipient models.TelegramRecipient, item dto.SurebetView) bool {
	switch classifyOpportunityOddsProfile(item) {
	case opportunityOddsProfileOneNegativeOnePositive:
		return recipient.ReceivesOneNegativeOnePositive
	case opportunityOddsProfileTwoNegative:
		return recipient.ReceivesTwoNegative
	default:
		return recipient.ReceivesOneNegativeOnePositive || recipient.ReceivesTwoNegative
	}
}

func classifyOpportunityOddsProfile(item dto.SurebetView) opportunityOddsProfile {
	negativeCount := 0
	positiveCount := 0

	for _, leg := range item.Legs {
		switch {
		case leg.Odds < 0:
			negativeCount += 1
		case leg.Odds > 0:
			positiveCount += 1
		}
	}

	switch {
	case negativeCount >= 2 && positiveCount == 0:
		return opportunityOddsProfileTwoNegative
	case negativeCount >= 1 && positiveCount >= 1:
		return opportunityOddsProfileOneNegativeOnePositive
	default:
		return opportunityOddsProfileUnknown
	}
}
