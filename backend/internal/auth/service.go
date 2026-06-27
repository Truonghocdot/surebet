package auth

import (
	"context"
	"time"
)

type Claims struct {
	UserID    string    `json:"user_id"`
	Email     string    `json:"email"`
	Roles     []string  `json:"roles"`
	ExpiresAt time.Time `json:"expires_at"`
}

type TokenManager interface {
	IssueAccessToken(ctx context.Context, claims Claims) (string, error)
	ParseAccessToken(ctx context.Context, token string) (Claims, error)
}

type SessionAuthorizer interface {
	ValidateAccountAccess(ctx context.Context, userID, accountID string) error
}
