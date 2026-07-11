package dto

type TelegramWebhookUpdate struct {
	MyChatMember *TelegramMyChatMemberUpdate `json:"my_chat_member"`
}

type TelegramMyChatMemberUpdate struct {
	Chat          TelegramChat       `json:"chat"`
	NewChatMember TelegramChatMember `json:"new_chat_member"`
}

type TelegramChat struct {
	ID        int64  `json:"id"`
	Type      string `json:"type"`
	Title     string `json:"title"`
	Username  string `json:"username"`
	FirstName string `json:"first_name"`
	LastName  string `json:"last_name"`
}

type TelegramChatMember struct {
	Status string `json:"status"`
}

type TelegramWebhookResult struct {
	Status           string `json:"status"`
	Reason           string `json:"reason,omitempty"`
	ChatID           string `json:"chat_id,omitempty"`
	ChatType         string `json:"chat_type,omitempty"`
	MembershipStatus string `json:"membership_status,omitempty"`
	IsActive         *bool  `json:"is_active,omitempty"`
}
