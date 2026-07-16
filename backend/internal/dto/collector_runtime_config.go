package dto

type CollectorRuntimeConfigView struct {
	EightXBetPageURL       string `json:"eightxbet_page_url"`
	EightXBetBaseURL       string `json:"eightxbet_base_url"`
	EightXBetInplayPageURL string `json:"eightxbet_inplay_page_url"`
	Jun88BaseURL           string `json:"jun88_base_url"`
	Jun88CmdPageURL        string `json:"jun88_cmd_page_url"`
	CollectorProxyEnabled  bool   `json:"collector_proxy_enabled"`
	CollectorProxyProtocol string `json:"collector_proxy_protocol"`
	CollectorProxyServer   string `json:"collector_proxy_server"`
	CollectorProxyBypass   string `json:"collector_proxy_bypass"`
}

type UpdateCollectorRuntimeConfigRequest struct {
	EightXBetPageURL       string `json:"eightxbet_page_url"`
	EightXBetBaseURL       string `json:"eightxbet_base_url"`
	EightXBetInplayPageURL string `json:"eightxbet_inplay_page_url"`
	Jun88BaseURL           string `json:"jun88_base_url"`
	Jun88CmdPageURL        string `json:"jun88_cmd_page_url"`
	CollectorProxyEnabled  bool   `json:"collector_proxy_enabled"`
	CollectorProxyProtocol string `json:"collector_proxy_protocol"`
	CollectorProxyServer   string `json:"collector_proxy_server"`
	CollectorProxyBypass   string `json:"collector_proxy_bypass"`
}
