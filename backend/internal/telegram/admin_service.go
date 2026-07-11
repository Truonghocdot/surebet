package telegram

import (
	"context"
	"strings"

	"surebet/backend/internal/dto"
	"surebet/backend/internal/models"
)

type AdminRecipientWriter interface {
	ListAll(ctx context.Context) ([]models.TelegramRecipient, error)
	GetByID(ctx context.Context, id uint64) (models.TelegramRecipient, error)
	Save(ctx context.Context, recipient models.TelegramRecipient) (models.TelegramRecipient, error)
	DeleteByID(ctx context.Context, id uint64) error
}

type AdminService struct {
	recipients AdminRecipientWriter
}

func NewAdminService(recipients AdminRecipientWriter) AdminService {
	return AdminService{recipients: recipients}
}

func (s AdminService) ListRecipients(ctx context.Context) ([]dto.TelegramRecipientView, error) {
	recipients, err := s.recipients.ListAll(ctx)
	if err != nil {
		return nil, err
	}

	items := make([]dto.TelegramRecipientView, 0, len(recipients))
	for _, recipient := range recipients {
		items = append(items, mapTelegramRecipientView(recipient))
	}
	return items, nil
}

func (s AdminService) CreateRecipient(
	ctx context.Context,
	request dto.UpsertTelegramRecipientRequest,
) (dto.TelegramRecipientView, error) {
	recipient, err := s.recipients.Save(ctx, models.TelegramRecipient{
		Name:     strings.TrimSpace(request.Name),
		ChatID:   strings.TrimSpace(request.ChatID),
		IsActive: request.IsActive,
		Notes:    strings.TrimSpace(request.Notes),
		Source:   "manual",
	})
	if err != nil {
		return dto.TelegramRecipientView{}, err
	}

	return mapTelegramRecipientView(recipient), nil
}

func (s AdminService) UpdateRecipient(
	ctx context.Context,
	id uint64,
	request dto.UpsertTelegramRecipientRequest,
) (dto.TelegramRecipientView, error) {
	recipient, err := s.recipients.GetByID(ctx, id)
	if err != nil {
		return dto.TelegramRecipientView{}, err
	}

	recipient.Name = strings.TrimSpace(request.Name)
	recipient.ChatID = strings.TrimSpace(request.ChatID)
	recipient.IsActive = request.IsActive
	recipient.Notes = strings.TrimSpace(request.Notes)
	if strings.TrimSpace(recipient.Source) == "" {
		recipient.Source = "manual"
	}

	saved, err := s.recipients.Save(ctx, recipient)
	if err != nil {
		return dto.TelegramRecipientView{}, err
	}

	return mapTelegramRecipientView(saved), nil
}

func (s AdminService) DeleteRecipient(ctx context.Context, id uint64) error {
	return s.recipients.DeleteByID(ctx, id)
}

func mapTelegramRecipientView(recipient models.TelegramRecipient) dto.TelegramRecipientView {
	return dto.TelegramRecipientView{
		ID:               recipient.ID,
		Name:             recipient.Name,
		ChatID:           recipient.ChatID,
		IsActive:         recipient.IsActive,
		Notes:            recipient.Notes,
		Source:           recipient.Source,
		ChatType:         recipient.ChatType,
		TelegramUsername: recipient.TelegramUsername,
		MembershipStatus: recipient.MembershipStatus,
		LastSeenAt:       recipient.LastSeenAt,
		CreatedAt:        recipient.CreatedAt,
		UpdatedAt:        recipient.UpdatedAt,
	}
}
