package repository

type OddsSource struct {
	BookmakerID string
	LobbyID     string
}

var activeOddsSources = []OddsSource{
	{BookmakerID: "8xbet", LobbyID: "default"},
	{BookmakerID: "jun88", LobbyID: "cmd"},
}

var migratedOddsSources = []OddsSource{
	{BookmakerID: "8xbet", LobbyID: "default"},
	{BookmakerID: "jun88", LobbyID: "cmd"},
}

func ActiveOddsSources() []OddsSource {
	return append([]OddsSource(nil), activeOddsSources...)
}

func MigratedOddsSources() []OddsSource {
	return append([]OddsSource(nil), migratedOddsSources...)
}

func LegacyOddsSources() []OddsSource {
	legacy := make([]OddsSource, 0, len(activeOddsSources))
	for _, source := range activeOddsSources {
		if ContainsOddsSource(migratedOddsSources, source.BookmakerID, source.LobbyID) {
			continue
		}
		legacy = append(legacy, source)
	}
	return legacy
}

func MatchOddsSources(bookmakerID, lobbyID string, sources []OddsSource) []OddsSource {
	matched := make([]OddsSource, 0, len(sources))
	for _, source := range sources {
		if bookmakerID != "" && source.BookmakerID != bookmakerID {
			continue
		}
		if lobbyID != "" && source.LobbyID != lobbyID {
			continue
		}
		matched = append(matched, source)
	}
	return matched
}

func ContainsOddsSource(sources []OddsSource, bookmakerID, lobbyID string) bool {
	for _, source := range sources {
		if source.BookmakerID == bookmakerID && source.LobbyID == lobbyID {
			return true
		}
	}
	return false
}

func OddsSourceKey(bookmakerID, lobbyID string) string {
	return bookmakerID + "|" + lobbyID
}
