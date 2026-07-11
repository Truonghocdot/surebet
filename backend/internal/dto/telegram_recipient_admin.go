package dto

import "time"

type TelegramRecipientView struct {
	ID               uint64     `json:"id"`
	Name             string     `json:"name"`
	ChatID           string     `json:"chat_id"`
	IsActive         bool       `json:"is_active"`
	Notes            string     `json:"notes"`
	Source           string     `json:"source"`
	ChatType         string     `json:"chat_type"`
	TelegramUsername string     `json:"telegram_username"`
	MembershipStatus string     `json:"membership_status"`
	LastSeenAt       *time.Time `json:"last_seen_at,omitempty"`
	CreatedAt        time.Time  `json:"created_at"`
	UpdatedAt        time.Time  `json:"updated_at"`
}

type UpsertTelegramRecipientRequest struct {
	Name     string `json:"name" binding:"required"`
	ChatID   string `json:"chat_id" binding:"required"`
	IsActive bool   `json:"is_active"`
	Notes    string `json:"notes"`
}
