package dto

import "time"

type LoginRequest struct {
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required,min=8"`
}

type AuthenticatedUserView struct {
	ID          string     `json:"id"`
	Email       string     `json:"email"`
	FullName    string     `json:"full_name"`
	Role        string     `json:"role"`
	LastLoginAt *time.Time `json:"last_login_at,omitempty"`
}

type LoginResponse struct {
	AccessToken string                `json:"access_token"`
	TokenType   string                `json:"token_type"`
	ExpiresAt   time.Time             `json:"expires_at"`
	User        AuthenticatedUserView `json:"user"`
}
