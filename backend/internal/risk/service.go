package risk

import (
	"context"
	"time"

	"surebet/backend/internal/models"
)

type Outcome string

const (
	OutcomeAccept Outcome = "ACCEPT"
	OutcomeReview Outcome = "REVIEW"
	OutcomeReject Outcome = "REJECT"
)

type RuleHit struct {
	Name   string `json:"name"`
	Weight int    `json:"weight"`
	Reason string `json:"reason"`
}

type AssessmentInput struct {
	Order       models.BetOrder
	Opportunity models.SurebetOpportunity
	Account     models.Account
}

type Assessment struct {
	Score       int       `json:"score"`
	Outcome     Outcome   `json:"outcome"`
	RuleHits    []RuleHit `json:"rule_hits"`
	EvaluatedAt time.Time `json:"evaluated_at"`
}

type Engine interface {
	Assess(ctx context.Context, input AssessmentInput) (Assessment, error)
}
