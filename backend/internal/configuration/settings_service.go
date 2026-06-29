package configuration

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"

	"surebet/backend/internal/dto"
	"surebet/backend/internal/models"
	"surebet/backend/internal/repository"
)

type SettingsService interface {
	ListBookmakerSettings(ctx context.Context) ([]dto.BookmakerSettingView, error)
	UpdateBookmakerSetting(ctx context.Context, request dto.UpdateBookmakerSettingRequest) (dto.BookmakerSettingView, error)
}

type settingsService struct {
	bookmakers repository.BookmakerRepository
	accounts   repository.AccountRepository
}

func NewSettingsService(
	bookmakers repository.BookmakerRepository,
	accounts repository.AccountRepository,
) SettingsService {
	return settingsService{
		bookmakers: bookmakers,
		accounts:   accounts,
	}
}

func (s settingsService) ListBookmakerSettings(ctx context.Context) ([]dto.BookmakerSettingView, error) {
	bookmakers, err := s.bookmakers.List(ctx)
	if err != nil {
		return nil, err
	}

	settings := make([]dto.BookmakerSettingView, 0, len(bookmakers))
	for _, bookmaker := range bookmakers {
		if bookmaker.Code != "8xbet" && bookmaker.Code != "jun88" {
			continue
		}

		account, err := s.accounts.GetByExternalRef(ctx, defaultExternalRef(bookmaker.Code))
		if err != nil && err != repository.ErrNotFound {
			return nil, err
		}

		settings = append(settings, dto.BookmakerSettingView{
			BookmakerCode: bookmaker.Code,
			BookmakerName: bookmaker.Name,
			URL:           bookmaker.SiteURL,
			Username:      account.LoginUsername,
			Password:      account.LoginPassword,
		})
	}

	return settings, nil
}

func (s settingsService) UpdateBookmakerSetting(ctx context.Context, request dto.UpdateBookmakerSettingRequest) (dto.BookmakerSettingView, error) {
	bookmaker, err := s.bookmakers.GetByCode(ctx, request.BookmakerCode)
	if err != nil {
		return dto.BookmakerSettingView{}, err
	}

	bookmaker.SiteURL = request.URL
	if err := s.bookmakers.Upsert(ctx, bookmaker); err != nil {
		return dto.BookmakerSettingView{}, err
	}

	account, err := s.accounts.GetByExternalRef(ctx, defaultExternalRef(request.BookmakerCode))
	if err != nil {
		if err != repository.ErrNotFound {
			return dto.BookmakerSettingView{}, err
		}

		account = models.Account{
			BaseModel:      models.BaseModel{ID: uuid.NewString()},
			UserID:         "",
			BookmakerID:    bookmaker.ID,
			ExternalRef:    defaultExternalRef(request.BookmakerCode),
			Label:          fmt.Sprintf("%s Config", bookmaker.Name),
			LoginUsername:  request.Username,
			LoginPassword:  request.Password,
			Currency:       "USD",
			Balance:        0,
			AvailableStake: 0,
			IsEnabled:      true,
		}
	} else {
		account.BookmakerID = bookmaker.ID
		account.LoginUsername = request.Username
		account.LoginPassword = request.Password
		if strings.TrimSpace(account.Label) == "" {
			account.Label = fmt.Sprintf("%s Config", bookmaker.Name)
		}
	}

	if err := s.accounts.Upsert(ctx, account); err != nil {
		return dto.BookmakerSettingView{}, err
	}

	return dto.BookmakerSettingView{
		BookmakerCode: bookmaker.Code,
		BookmakerName: bookmaker.Name,
		URL:           bookmaker.SiteURL,
		Username:      account.LoginUsername,
		Password:      account.LoginPassword,
	}, nil
}

func defaultExternalRef(bookmakerCode string) string {
	return bookmakerCode + "-primary"
}
