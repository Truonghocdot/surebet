package surebet

import (
	"context"

	"surebet/backend/internal/dto"
)

type VerifiedOpportunityReader interface {
	Get(ctx context.Context, opportunityID string) (dto.SurebetView, bool, error)
	List(ctx context.Context) ([]dto.SurebetView, error)
}

type VerifiedQueryService struct {
	candidates CurrentSurebetReader
	verified   VerifiedOpportunityReader
}

func NewVerifiedQueryService(
	candidates CurrentSurebetReader,
	verified VerifiedOpportunityReader,
) *VerifiedQueryService {
	return &VerifiedQueryService{candidates: candidates, verified: verified}
}

func (s *VerifiedQueryService) ListCurrentSurebets(ctx context.Context) ([]dto.SurebetView, error) {
	items, err := s.candidates.ListCurrentSurebets(ctx)
	if err != nil || s.verified == nil {
		return items, err
	}
	verified, err := s.verified.List(ctx)
	if err != nil {
		return nil, err
	}
	verifiedByID := make(map[string]dto.SurebetView, len(verified))
	for _, item := range verified {
		verifiedByID[item.ID] = item
	}
	for index, item := range items {
		if current, ok := verifiedByID[item.ID]; ok {
			items[index] = current
		}
	}
	return items, nil
}
