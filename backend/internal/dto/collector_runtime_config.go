package dto

type CollectorRuntimeConfigView struct {
	EightXBetPageURL  string `json:"eightxbet_page_url"`
	EightXBetBaseURL  string `json:"eightxbet_base_url"`
	Jun88BaseURL      string `json:"jun88_base_url"`
	Jun88BtiPageURL   string `json:"jun88_bti_page_url"`
	Jun88SabaPageURL  string `json:"jun88_saba_page_url"`
	Jun88CmdPageURL   string `json:"jun88_cmd_page_url"`
	Jun88M9BetPageURL string `json:"jun88_m9bet_page_url"`
}

type UpdateCollectorRuntimeConfigRequest struct {
	EightXBetPageURL  string `json:"eightxbet_page_url"`
	EightXBetBaseURL  string `json:"eightxbet_base_url"`
	Jun88BaseURL      string `json:"jun88_base_url"`
	Jun88BtiPageURL   string `json:"jun88_bti_page_url"`
	Jun88SabaPageURL  string `json:"jun88_saba_page_url"`
	Jun88CmdPageURL   string `json:"jun88_cmd_page_url"`
	Jun88M9BetPageURL string `json:"jun88_m9bet_page_url"`
}
