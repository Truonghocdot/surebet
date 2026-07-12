package telegram

import (
	"context"
	"testing"
	"time"

	"surebet/backend/internal/config"
	"surebet/backend/internal/dto"
	"surebet/backend/internal/models"
	"surebet/backend/internal/repository"
)

type stubWebhookRecipientRepo struct {
	byChatID map[string]models.TelegramRecipient
}

func (r *stubWebhookRecipientRepo) GetByChatID(
	_ context.Context,
	chatID string,
) (models.TelegramRecipient, error) {
	recipient, ok := r.byChatID[chatID]
	if !ok {
		return models.TelegramRecipient{}, repository.ErrNotFound
	}
	return recipient, nil
}

func (r *stubWebhookRecipientRepo) Upsert(
	_ context.Context,
	recipient models.TelegramRecipient,
) error {
	if r.byChatID == nil {
		r.byChatID = make(map[string]models.TelegramRecipient)
	}
	r.byChatID[recipient.ChatID] = recipient
	return nil
}

func TestWebhookServiceCreatesInactiveRecipientFromMyChatMember(t *testing.T) {
	repo := &stubWebhookRecipientRepo{}
	service := NewWebhookService(config.TelegramConfig{}, repo)

	result, err := service.HandleUpdate(context.Background(), dto.TelegramWebhookUpdate{
		MyChatMember: &dto.TelegramMyChatMemberUpdate{
			Chat: dto.TelegramChat{
				ID:       -1001234567890,
				Type:     "group",
				Title:    "Surebet Ops",
				Username: "surebet_ops",
			},
			NewChatMember: dto.TelegramChatMember{
				Status: "member",
			},
		},
	})
	if err != nil {
		t.Fatalf("handle update returned error: %v", err)
	}
	if result.Status != "created" {
		t.Fatalf("expected created result, got %q", result.Status)
	}

	recipient, ok := repo.byChatID["-1001234567890"]
	if !ok {
		t.Fatalf("expected recipient to be persisted")
	}
	if recipient.IsActive {
		t.Fatalf("expected newly created recipient to be inactive")
	}
	if recipient.Source != "telegram_webhook" {
		t.Fatalf("expected source telegram_webhook, got %q", recipient.Source)
	}
	if recipient.TelegramUsername != "@surebet_ops" {
		t.Fatalf("expected normalized username, got %q", recipient.TelegramUsername)
	}
	if recipient.LastSeenAt == nil || recipient.LastSeenAt.Before(time.Now().UTC().Add(-time.Minute)) {
		t.Fatalf("expected last seen timestamp to be set")
	}
}

func TestWebhookServiceCreatesInactiveRecipientFromMessageStart(t *testing.T) {
	repo := &stubWebhookRecipientRepo{}
	service := NewWebhookService(config.TelegramConfig{}, repo)

	result, err := service.HandleUpdate(context.Background(), dto.TelegramWebhookUpdate{
		Message: &dto.TelegramMessageUpdate{
			Chat: dto.TelegramChat{
				ID:        123456789,
				Type:      "private",
				FirstName: "Truong",
				LastName:  "Hoc",
				Username:  "truonghocdot",
			},
			Text: "/start",
		},
	})
	if err != nil {
		t.Fatalf("handle update returned error: %v", err)
	}
	if result.Status != "created" {
		t.Fatalf("expected created result, got %q", result.Status)
	}

	recipient, ok := repo.byChatID["123456789"]
	if !ok {
		t.Fatalf("expected recipient to be persisted")
	}
	if recipient.IsActive {
		t.Fatalf("expected newly created recipient to remain inactive until approved")
	}
	if recipient.Name != "@truonghocdot" {
		t.Fatalf("expected username to be preferred as display name, got %q", recipient.Name)
	}
	if recipient.ChatType != "private" {
		t.Fatalf("expected chat type private, got %q", recipient.ChatType)
	}
}

func TestWebhookServiceValidateSecret(t *testing.T) {
	service := NewWebhookService(config.TelegramConfig{
		WebhookSecret: "top-secret",
	}, &stubWebhookRecipientRepo{})

	if !service.ValidateSecret("top-secret") {
		t.Fatalf("expected matching secret to validate")
	}
	if service.ValidateSecret("wrong-secret") {
		t.Fatalf("expected wrong secret to be rejected")
	}
	if service.ValidateSecret("") {
		t.Fatalf("expected empty secret to be rejected when configured")
	}
}
