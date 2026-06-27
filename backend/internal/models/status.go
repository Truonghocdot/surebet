package models

type BetStatus string

const (
	BetStatusCreated             BetStatus = "CREATED"
	BetStatusValidating          BetStatus = "VALIDATING"
	BetStatusWaitingConfirmation BetStatus = "WAITING_CONFIRMATION"
	BetStatusReady               BetStatus = "READY"
	BetStatusBetting             BetStatus = "BETTING"
	BetStatusSuccess             BetStatus = "SUCCESS"
	BetStatusFailed              BetStatus = "FAILED"
	BetStatusCancelled           BetStatus = "CANCELLED"
	BetStatusRollbackRequired    BetStatus = "ROLLBACK_REQUIRED"
)

func (s BetStatus) IsTerminal() bool {
	switch s {
	case BetStatusSuccess, BetStatusFailed, BetStatusCancelled, BetStatusRollbackRequired:
		return true
	default:
		return false
	}
}

type ExecutionMode string

const (
	ExecutionModeManual ExecutionMode = "MANUAL"
	ExecutionModeAuto   ExecutionMode = "AUTO"
)

type SessionStatus string

const (
	SessionStatusActive  SessionStatus = "ACTIVE"
	SessionStatusExpired SessionStatus = "EXPIRED"
	SessionStatusRevoked SessionStatus = "REVOKED"
	SessionStatusInvalid SessionStatus = "INVALID"
)
