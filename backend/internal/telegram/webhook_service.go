package telegram

import (
	"context"
	"crypto/subtle"
	"fmt"
	"strings"
	"time"

	"surebet/backend/internal/config"
	"surebet/backend/internal/dto"
	"surebet/backend/internal/models"
	"surebet/backend/internal/repository"
)

type WebhookRecipientWriter interface {
	GetByChatID(ctx context.Context, chatID string) (models.TelegramRecipient, error)
	Upsert(ctx context.Context, recipient models.TelegramRecipient) error
}

type WebhookService struct {
	cfg        config.TelegramConfig
	recipients WebhookRecipientWriter
}

func NewWebhookService(
	cfg config.TelegramConfig,
	recipients WebhookRecipientWriter,
) WebhookService {
	return WebhookService{
		cfg:        cfg,
		recipients: recipients,
	}
}

func (s WebhookService) ValidateSecret(provided string) bool {
	expected := strings.TrimSpace(s.cfg.WebhookSecret)
	if expected == "" {
		return true
	}

	normalized := strings.TrimSpace(provided)
	if normalized == "" {
		return false
	}

	return subtle.ConstantTimeCompare([]byte(expected), []byte(normalized)) == 1
}

func (s WebhookService) HandleUpdate(
	ctx context.Context,
	update dto.TelegramWebhookUpdate,
) (dto.TelegramWebhookResult, error) {
	if update.MyChatMember == nil {
		return dto.TelegramWebhookResult{
			Status: "ignored",
			Reason: "unsupported_update",
		}, nil
	}

	return s.syncRecipientFromMyChatMember(ctx, *update.MyChatMember)
}

func (s WebhookService) syncRecipientFromMyChatMember(
	ctx context.Context,
	payload dto.TelegramMyChatMemberUpdate,
) (dto.TelegramWebhookResult, error) {
	chatID := fmt.Sprint(payload.Chat.ID)
	if strings.TrimSpace(chatID) == "" || chatID == "0" {
		return dto.TelegramWebhookResult{
			Status: "ignored",
			Reason: "missing_chat",
		}, nil
	}

	now := time.Now().UTC()
	membershipStatus := strings.TrimSpace(payload.NewChatMember.Status)
	chatType := strings.TrimSpace(payload.Chat.Type)
	chatName := resolveChatName(payload.Chat)
	username := normalizeUsername(payload.Chat.Username)

	recipient, err := s.recipients.GetByChatID(ctx, chatID)
	wasCreated := false
	if err != nil {
		if err != repository.ErrNotFound {
			return dto.TelegramWebhookResult{}, err
		}

		recipient = models.TelegramRecipient{
			ChatID: chatID,
		}
		wasCreated = true
	}

	recipient.Name = chatName
	recipient.ChatType = chatType
	recipient.TelegramUsername = username
	if strings.TrimSpace(recipient.Source) == "" {
		recipient.Source = "telegram_webhook"
	}
	recipient.MembershipStatus = membershipStatus
	recipient.LastSeenAt = &now

	if wasCreated {
		recipient.IsActive = false
		if strings.TrimSpace(recipient.Notes) == "" {
			recipient.Notes = "Được tạo từ webhook Telegram. Bật thông báo trong dashboard nếu cần gửi surebet vào chat này."
		}
	} else if isInactiveMembershipStatus(membershipStatus) {
		recipient.IsActive = false
	}

	if err := s.recipients.Upsert(ctx, recipient); err != nil {
		return dto.TelegramWebhookResult{}, err
	}

	return dto.TelegramWebhookResult{
		Status:           ternary(wasCreated, "created", "updated"),
		ChatID:           recipient.ChatID,
		ChatType:         recipient.ChatType,
		MembershipStatus: recipient.MembershipStatus,
		IsActive:         boolPtr(recipient.IsActive),
	}, nil
}

func resolveChatName(chat dto.TelegramChat) string {
	title := strings.TrimSpace(chat.Title)
	if title != "" {
		return title
	}

	username := normalizeUsername(chat.Username)
	if username != "" {
		return username
	}

	fullName := strings.TrimSpace(strings.TrimSpace(chat.FirstName) + " " + strings.TrimSpace(chat.LastName))
	if fullName != "" {
		return fullName
	}

	return "Telegram chat " + fmt.Sprint(chat.ID)
}

func normalizeUsername(value string) string {
	username := strings.TrimSpace(value)
	if username == "" {
		return ""
	}

	return "@" + strings.TrimLeft(username, "@")
}

func isInactiveMembershipStatus(status string) bool {
	switch strings.TrimSpace(status) {
	case "left", "kicked":
		return true
	default:
		return false
	}
}

func boolPtr(value bool) *bool {
	return &value
}

func ternary[T any](condition bool, whenTrue, whenFalse T) T {
	if condition {
		return whenTrue
	}
	return whenFalse
}
