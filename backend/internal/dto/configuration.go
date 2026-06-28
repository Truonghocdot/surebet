package dto

type BookmakerView struct {
	ID           string `json:"id"`
	Code         string `json:"code"`
	Name         string `json:"name"`
	SiteURL      string `json:"site_url"`
	Region       string `json:"region"`
	IsEnabled    bool   `json:"is_enabled"`
	SupportsAuto bool   `json:"supports_auto"`
}

type BookmakerAccountView struct {
	ID               string  `json:"id"`
	BookmakerID      string  `json:"bookmaker_id"`
	BookmakerCode    string  `json:"bookmaker_code"`
	BookmakerName    string  `json:"bookmaker_name"`
	BookmakerSiteURL string  `json:"bookmaker_site_url"`
	ExternalRef      string  `json:"external_ref"`
	Label            string  `json:"label"`
	LoginUsername    string  `json:"login_username"`
	HasLoginPassword bool    `json:"has_login_password"`
	Currency         string  `json:"currency"`
	Balance          float64 `json:"balance"`
	AvailableStake   float64 `json:"available_stake"`
	IsEnabled        bool    `json:"is_enabled"`
}

type ConfigurationView struct {
	Key         string `json:"key"`
	Value       string `json:"value"`
	ValueType   string `json:"value_type"`
	Description string `json:"description"`
}
