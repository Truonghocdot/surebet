package configuration

import (
	"context"

	"surebet/backend/internal/dto"
	"surebet/backend/internal/repository"
)

type QueryService interface {
	ListBookmakers(ctx context.Context) ([]dto.BookmakerView, error)
	ListBookmakerAccounts(ctx context.Context) ([]dto.BookmakerAccountView, error)
	ListConfigurations(ctx context.Context, prefix string) ([]dto.ConfigurationView, error)
}

type queryService struct {
	bookmakers     repository.BookmakerRepository
	accounts       repository.AccountRepository
	configurations repository.ConfigurationRepository
}

func NewQueryService(
	bookmakers repository.BookmakerRepository,
	accounts repository.AccountRepository,
	configurations repository.ConfigurationRepository,
) QueryService {
	return queryService{
		bookmakers:     bookmakers,
		accounts:       accounts,
		configurations: configurations,
	}
}

func (s queryService) ListBookmakers(ctx context.Context) ([]dto.BookmakerView, error) {
	bookmakers, err := s.bookmakers.List(ctx)
	if err != nil {
		return nil, err
	}

	items := make([]dto.BookmakerView, 0, len(bookmakers))
	for _, bookmaker := range bookmakers {
		items = append(items, dto.BookmakerView{
			ID:           bookmaker.ID,
			Code:         bookmaker.Code,
			Name:         bookmaker.Name,
			SiteURL:      bookmaker.SiteURL,
			Region:       bookmaker.Region,
			IsEnabled:    bookmaker.IsEnabled,
			SupportsAuto: bookmaker.SupportsAuto,
		})
	}

	return items, nil
}

func (s queryService) ListBookmakerAccounts(ctx context.Context) ([]dto.BookmakerAccountView, error) {
	bookmakers, err := s.bookmakers.List(ctx)
	if err != nil {
		return nil, err
	}

	bookmakerIndex := make(map[string]dto.BookmakerView, len(bookmakers))
	for _, bookmaker := range bookmakers {
		bookmakerIndex[bookmaker.ID] = dto.BookmakerView{
			ID:           bookmaker.ID,
			Code:         bookmaker.Code,
			Name:         bookmaker.Name,
			SiteURL:      bookmaker.SiteURL,
			Region:       bookmaker.Region,
			IsEnabled:    bookmaker.IsEnabled,
			SupportsAuto: bookmaker.SupportsAuto,
		}
	}

	accounts, err := s.accounts.List(ctx)
	if err != nil {
		return nil, err
	}

	items := make([]dto.BookmakerAccountView, 0, len(accounts))
	for _, account := range accounts {
		bookmaker := bookmakerIndex[account.BookmakerID]
		items = append(items, dto.BookmakerAccountView{
			ID:               account.ID,
			BookmakerID:      bookmaker.ID,
			BookmakerCode:    bookmaker.Code,
			BookmakerName:    bookmaker.Name,
			BookmakerSiteURL: bookmaker.SiteURL,
			ExternalRef:      account.ExternalRef,
			Label:            account.Label,
			LoginUsername:    account.LoginUsername,
			HasLoginPassword: account.LoginPassword != "",
			Currency:         account.Currency,
			Balance:          account.Balance,
			AvailableStake:   account.AvailableStake,
			IsEnabled:        account.IsEnabled,
		})
	}

	return items, nil
}

func (s queryService) ListConfigurations(ctx context.Context, prefix string) ([]dto.ConfigurationView, error) {
	configurations, err := s.configurations.List(ctx, prefix)
	if err != nil {
		return nil, err
	}

	items := make([]dto.ConfigurationView, 0, len(configurations))
	for _, configuration := range configurations {
		items = append(items, dto.ConfigurationView{
			Key:         configuration.Key,
			Value:       configuration.Value,
			ValueType:   configuration.ValueType,
			Description: configuration.Description,
		})
	}

	return items, nil
}
