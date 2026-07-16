package dto

type CollectorSource struct {
	CollectorID string `json:"collector_id" binding:"required"`
	BookmakerID string `json:"bookmaker_id" binding:"required"`
	LobbyID     string `json:"lobby_id" binding:"required"`
}
