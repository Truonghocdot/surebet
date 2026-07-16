package telegram

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"net/http"
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
	client     *http.Client
	send       func(ctx context.Context, chatID, text string) error
}

func NewWebhookService(
	cfg config.TelegramConfig,
	recipients WebhookRecipientWriter,
) *WebhookService {
	timeout := cfg.RequestTimeout
	if timeout <= 0 {
		timeout = 10 * time.Second
	}

	service := &WebhookService{
		cfg:        cfg,
		recipients: recipients,
		client:     &http.Client{Timeout: timeout},
	}
	service.send = service.sendTelegramMessage
	return service
}

func (s *WebhookService) ValidateSecret(provided string) bool {
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

func (s *WebhookService) HandleUpdate(
	ctx context.Context,
	update dto.TelegramWebhookUpdate,
) (dto.TelegramWebhookResult, error) {
	if update.MyChatMember != nil {
		result, err := s.syncRecipientFromMyChatMember(ctx, *update.MyChatMember)
		if err != nil {
			return dto.TelegramWebhookResult{}, err
		}
		if result.Status == "created" && shouldReplyToMembership(update.MyChatMember.NewChatMember.Status) {
			if err := s.send(ctx, result.ChatID, "Chờ em Trường tí"); err != nil {
				return dto.TelegramWebhookResult{}, err
			}
		}
		return result, nil
	}

	if update.Message != nil {
		result, err := s.syncRecipientFromMessage(ctx, *update.Message)
		if err != nil {
			return dto.TelegramWebhookResult{}, err
		}
		if result.Status == "created" && shouldReplyToMessage(update.Message.Text) {
			if err := s.send(ctx, result.ChatID, "Chờ em Trường tí"); err != nil {
				return dto.TelegramWebhookResult{}, err
			}
		}
		return result, nil
	}

	return dto.TelegramWebhookResult{
		Status: "ignored",
		Reason: "unsupported_update",
	}, nil
}

func (s *WebhookService) syncRecipientFromMyChatMember(
	ctx context.Context,
	payload dto.TelegramMyChatMemberUpdate,
) (dto.TelegramWebhookResult, error) {
	return s.upsertRecipientFromChat(
		ctx,
		payload.Chat,
		strings.TrimSpace(payload.NewChatMember.Status),
	)
}

func (s *WebhookService) syncRecipientFromMessage(
	ctx context.Context,
	payload dto.TelegramMessageUpdate,
) (dto.TelegramWebhookResult, error) {
	return s.upsertRecipientFromChat(ctx, payload.Chat, "")
}

func (s *WebhookService) upsertRecipientFromChat(
	ctx context.Context,
	chat dto.TelegramChat,
	membershipStatus string,
) (dto.TelegramWebhookResult, error) {
	chatID := fmt.Sprint(chat.ID)
	if strings.TrimSpace(chatID) == "" || chatID == "0" {
		return dto.TelegramWebhookResult{
			Status: "ignored",
			Reason: "missing_chat",
		}, nil
	}

	now := time.Now().UTC()
	chatType := strings.TrimSpace(chat.Type)
	chatName := resolveChatName(chat)
	username := normalizeUsername(chat.Username)

	recipient, err := s.recipients.GetByChatID(ctx, chatID)
	wasCreated := false
	if err != nil {
		if err != repository.ErrNotFound {
			return dto.TelegramWebhookResult{}, err
		}

		recipient = models.TelegramRecipient{
			ChatID:                         chatID,
			ReceivesOneNegativeOnePositive: true,
			ReceivesTwoNegative:            true,
		}
		wasCreated = true
	}

	recipient.Name = chatName
	recipient.ChatType = chatType
	recipient.TelegramUsername = username
	if strings.TrimSpace(recipient.Source) == "" {
		recipient.Source = "telegram_webhook"
	}
	if membershipStatus != "" {
		recipient.MembershipStatus = membershipStatus
	}
	recipient.LastSeenAt = &now

	if wasCreated {
		recipient.IsActive = false
		if strings.TrimSpace(recipient.Notes) == "" {
			recipient.Notes = "Được tạo từ webhook Telegram. Bật thông báo trong dashboard nếu cần gửi surebet vào chat này."
		}
	} else if membershipStatus != "" && isInactiveMembershipStatus(membershipStatus) {
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

func shouldReplyToMembership(status string) bool {
	switch strings.TrimSpace(status) {
	case "member", "administrator":
		return true
	default:
		return false
	}
}

func shouldReplyToMessage(text string) bool {
	normalized := strings.TrimSpace(text)
	return normalized == "/start" || strings.HasPrefix(normalized, "/start@")
}

func (s *WebhookService) sendTelegramMessage(
	ctx context.Context,
	chatID string,
	text string,
) error {
	if strings.TrimSpace(chatID) == "" || strings.TrimSpace(text) == "" {
		return nil
	}
	if strings.TrimSpace(s.cfg.BotToken) == "" {
		return nil
	}

	endpoint := strings.TrimRight(s.cfg.APIBaseURL, "/") + "/bot" + s.cfg.BotToken + "/sendMessage"
	body, err := json.Marshal(map[string]any{
		"chat_id": chatID,
		"text":    text,
	})
	if err != nil {
		return err
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")

	response, err := s.client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()

	if response.StatusCode >= http.StatusBadRequest {
		return fmt.Errorf("telegram api returned %s", response.Status)
	}

	return nil
}
