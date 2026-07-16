package runtimeconfig

import (
	"context"
	"strings"
	"sync"

	"surebet/backend/internal/config"
	"surebet/backend/internal/dto"
	"surebet/backend/internal/models"
)

const collectorSettingPrefix = "collector."

const (
	keyEightXBetPageURL        = collectorSettingPrefix + "eightxbet_page_url"
	keyEightXBetBaseURL        = collectorSettingPrefix + "eightxbet_base_url"
	keyEightXBetInplayPageURL  = collectorSettingPrefix + "eightxbet_inplay_page_url"
	keyJun88BaseURL            = collectorSettingPrefix + "jun88_base_url"
	keyJun88CmdPageURL         = collectorSettingPrefix + "jun88_cmd_page_url"
	keyCollectorProxyXoayToken = collectorSettingPrefix + "proxyxoay_token"
)

type SettingReaderWriter interface {
	ListByPrefix(ctx context.Context, prefix string) ([]models.RuntimeSetting, error)
	UpsertMany(ctx context.Context, settings []models.RuntimeSetting) error
}

type Service struct {
	repo     SettingReaderWriter
	defaults config.CollectorRuntimeConfig

	mu     sync.RWMutex
	cached dto.CollectorRuntimeConfigView
	loaded bool
}

func NewService(
	repo SettingReaderWriter,
	defaults config.CollectorRuntimeConfig,
) *Service {
	return &Service{
		repo:     repo,
		defaults: defaults,
	}
}

func (s *Service) GetCollectorConfig(
	ctx context.Context,
) (dto.CollectorRuntimeConfigView, error) {
	s.mu.RLock()
	if s.loaded {
		cached := s.cached
		s.mu.RUnlock()
		return cached, nil
	}
	s.mu.RUnlock()

	s.mu.Lock()
	defer s.mu.Unlock()
	if s.loaded {
		return s.cached, nil
	}

	configValue, err := s.loadCollectorConfig(ctx)
	if err != nil {
		return dto.CollectorRuntimeConfigView{}, err
	}

	s.cached = configValue
	s.loaded = true
	return s.cached, nil
}

func (s *Service) UpdateCollectorConfig(
	ctx context.Context,
	request dto.UpdateCollectorRuntimeConfigRequest,
) (dto.CollectorRuntimeConfigView, error) {
	configValue := dto.CollectorRuntimeConfigView{
		EightXBetPageURL:        strings.TrimSpace(request.EightXBetPageURL),
		EightXBetBaseURL:        strings.TrimSpace(request.EightXBetBaseURL),
		EightXBetInplayPageURL:  strings.TrimSpace(request.EightXBetInplayPageURL),
		Jun88BaseURL:            strings.TrimSpace(request.Jun88BaseURL),
		Jun88CmdPageURL:         strings.TrimSpace(request.Jun88CmdPageURL),
		CollectorProxyXoayToken: strings.TrimSpace(request.CollectorProxyXoayToken),
	}

	if err := s.repo.UpsertMany(ctx, toSettings(configValue)); err != nil {
		return dto.CollectorRuntimeConfigView{}, err
	}

	s.mu.Lock()
	s.cached = configValue
	s.loaded = true
	s.mu.Unlock()

	return configValue, nil
}

func (s *Service) loadCollectorConfig(
	ctx context.Context,
) (dto.CollectorRuntimeConfigView, error) {
	items, err := s.repo.ListByPrefix(ctx, collectorSettingPrefix)
	if err != nil {
		return dto.CollectorRuntimeConfigView{}, err
	}

	result := dto.CollectorRuntimeConfigView{
		EightXBetPageURL:        strings.TrimSpace(s.defaults.EightXBetPageURL),
		EightXBetBaseURL:        strings.TrimSpace(s.defaults.EightXBetBaseURL),
		EightXBetInplayPageURL:  strings.TrimSpace(s.defaults.EightXBetInplayPageURL),
		Jun88BaseURL:            strings.TrimSpace(s.defaults.Jun88BaseURL),
		Jun88CmdPageURL:         strings.TrimSpace(s.defaults.Jun88CmdPageURL),
		CollectorProxyXoayToken: strings.TrimSpace(s.defaults.CollectorProxyXoayToken),
	}

	for _, item := range items {
		switch item.Key {
		case keyEightXBetPageURL:
			result.EightXBetPageURL = strings.TrimSpace(item.Value)
		case keyEightXBetBaseURL:
			result.EightXBetBaseURL = strings.TrimSpace(item.Value)
		case keyEightXBetInplayPageURL:
			result.EightXBetInplayPageURL = strings.TrimSpace(item.Value)
		case keyJun88BaseURL:
			result.Jun88BaseURL = strings.TrimSpace(item.Value)
		case keyJun88CmdPageURL:
			result.Jun88CmdPageURL = strings.TrimSpace(item.Value)
		case keyCollectorProxyXoayToken:
			result.CollectorProxyXoayToken = strings.TrimSpace(item.Value)
		}
	}

	return result, nil
}

func toSettings(configValue dto.CollectorRuntimeConfigView) []models.RuntimeSetting {
	return []models.RuntimeSetting{
		{Key: keyEightXBetPageURL, Value: configValue.EightXBetPageURL},
		{Key: keyEightXBetBaseURL, Value: configValue.EightXBetBaseURL},
		{Key: keyEightXBetInplayPageURL, Value: configValue.EightXBetInplayPageURL},
		{Key: keyJun88BaseURL, Value: configValue.Jun88BaseURL},
		{Key: keyJun88CmdPageURL, Value: configValue.Jun88CmdPageURL},
		{Key: keyCollectorProxyXoayToken, Value: configValue.CollectorProxyXoayToken},
	}
}
