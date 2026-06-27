package repository

import "fmt"

const (
	Namespace       = "surebet"
	PrefixOdds      = Namespace + ":odds"
	PrefixSurebet   = Namespace + ":surebet"
	PrefixSession   = Namespace + ":session"
	PrefixLock      = Namespace + ":lock"
	PrefixRateLimit = Namespace + ":ratelimit"
)

func OddsKey(bookmakerID, lobbyID, fixtureID, marketID, outcomeID string) string {
	return fmt.Sprintf("%s:%s:%s:%s:%s:%s", PrefixOdds, bookmakerID, lobbyID, fixtureID, marketID, outcomeID)
}

func SurebetKey(opportunityID string) string {
	return fmt.Sprintf("%s:%s", PrefixSurebet, opportunityID)
}

func SessionKey(accountID string) string {
	return fmt.Sprintf("%s:%s", PrefixSession, accountID)
}

func LockKey(resourceType, resourceID string) string {
	return fmt.Sprintf("%s:%s:%s", PrefixLock, resourceType, resourceID)
}

func RateLimitKey(scope string) string {
	return fmt.Sprintf("%s:%s", PrefixRateLimit, scope)
}
