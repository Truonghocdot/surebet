package dto

type CollectorRuntimeConfigView struct {
	EightXBetBaseURL        string `json:"eightxbet_base_url"`
	EightXBetInplayPageURL  string `json:"eightxbet_inplay_page_url"`
	Jun88BaseURL            string `json:"jun88_base_url"`
	Jun88CmdPageURL         string `json:"jun88_cmd_page_url"`
	CollectorProxyXoayToken string `json:"collector_proxyxoay_token"`
}

type UpdateCollectorRuntimeConfigRequest struct {
	EightXBetBaseURL        string `json:"eightxbet_base_url"`
	EightXBetInplayPageURL  string `json:"eightxbet_inplay_page_url"`
	Jun88BaseURL            string `json:"jun88_base_url"`
	Jun88CmdPageURL         string `json:"jun88_cmd_page_url"`
	CollectorProxyXoayToken string `json:"collector_proxyxoay_token"`
}
