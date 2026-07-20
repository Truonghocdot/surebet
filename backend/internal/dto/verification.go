package dto

import "time"

type VerifiedFixtureRef struct {
	BookmakerID string `json:"bookmaker_id"`
	LobbyID     string `json:"lobby_id"`
	FixtureID   string `json:"fixture_id"`
}

type SurebetVerificationEvent struct {
	OpportunityID string       `json:"opportunity_id"`
	Status        string       `json:"status"`
	Reason        string       `json:"reason,omitempty"`
	ConfirmedAt   time.Time    `json:"confirmed_at,omitempty"`
	ValidUntil    time.Time    `json:"valid_until,omitempty"`
	Opportunity   *SurebetView `json:"opportunity,omitempty"`
}

type VerificationRolloutSnapshot struct {
	Mode              string          `json:"mode"`
	StartedAt         time.Time       `json:"started_at"`
	CandidateTotal    int64           `json:"candidate_total"`
	ConfirmedTotal    int64           `json:"confirmed_total"`
	ErrorTotal        int64           `json:"error_total"`
	ParserErrorTotal  int64           `json:"parser_error_total"`
	ConsecutiveErrors int64           `json:"consecutive_errors"`
	Latencies         []time.Duration `json:"-"`
}
