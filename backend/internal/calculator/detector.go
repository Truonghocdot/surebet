package calculator

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"math"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode"

	"golang.org/x/text/unicode/norm"
	"surebet/backend/internal/models"
)

const (
	overUnderThreshold = 0.999
	handicapThreshold  = 0.999
)

var (
	linePattern          = regexp.MustCompile(`([+-]?\d+(?:\.\d+)?(?:/\d+(?:\.\d+)?)?)$`)
	outcomeSuffixPattern = regexp.MustCompile(`(?i)\s+(over|under|home|away|đội nhà|đội khách)\s+[+-]?\d+(?:\.\d+)?(?:/\d+(?:\.\d+)?)?\s*$`)
	shortTagPattern      = regexp.MustCompile(`(?i)\s+\((h|a)\)\s*$`)
	whitespacePattern    = regexp.MustCompile(`\s+`)
	separatorNormalizer  = regexp.MustCompile(`[^\p{L}\p{N}]+`)
)

type detector struct{}

func NewDetector() Detector {
	return detector{}
}

func (detector) Detect(_ context.Context, quotes []models.OddsQuote) ([]models.SurebetOpportunity, error) {
	normalized := normalizeQuotes(quotes)
	if len(normalized) == 0 {
		return nil, nil
	}

	grouped := groupQuotes(normalized)
	opportunities := make([]models.SurebetOpportunity, 0)

	for _, bucket := range grouped {
		if len(bucket.quotes) < 2 {
			continue
		}

		switch bucket.marketKind {
		case marketKindOverUnder:
			opportunities = append(opportunities, detectTwoWaySurebets(bucket, sideOver, sideUnder, overUnderThreshold)...)
		case marketKindHandicap:
			opportunities = append(opportunities, detectTwoWaySurebets(bucket, sideHome, sideAway, handicapThreshold)...)
		}
	}

	sort.Slice(opportunities, func(i, j int) bool {
		if opportunities[i].ProfitPercentage == opportunities[j].ProfitPercentage {
			return opportunities[i].ID < opportunities[j].ID
		}
		return opportunities[i].ProfitPercentage > opportunities[j].ProfitPercentage
	})

	return opportunities, nil
}

type marketKind string

const (
	marketKindUnknown   marketKind = ""
	marketKindOverUnder marketKind = "over_under"
	marketKindHandicap  marketKind = "handicap"
)

type outcomeSide string

const (
	sideUnknown outcomeSide = ""
	sideOver    outcomeSide = "over"
	sideUnder   outcomeSide = "under"
	sideHome    outcomeSide = "home"
	sideAway    outcomeSide = "away"
)

type normalizedQuote struct {
	quote                 models.OddsQuote
	sourceKey             string
	marketKind            marketKind
	periodKey             string
	lineKey               string
	side                  outcomeSide
	fixtureKey            string
	decimalOdds           float64
	displayOdds           float64
	canonicalParticipants [2]string
}

type quoteBucket struct {
	fixtureID  string
	fixtureKey string
	sport      string
	marketName string
	marketKind marketKind
	periodKey  string
	lineKey    string
	quotes     []normalizedQuote
}

func normalizeQuotes(quotes []models.OddsQuote) []normalizedQuote {
	fixtureParticipants := inferFixtureParticipants(quotes)
	result := make([]normalizedQuote, 0, len(quotes))
	for _, quote := range quotes {
		if quote.Suspended {
			continue
		}

		marketKind, periodKey, lineKey, side := normalizeQuote(quote)
		if marketKind == marketKindUnknown || side == sideUnknown || lineKey == "" {
			continue
		}

		decimal, ok := normalizeOdds(quote)
		if !ok {
			continue
		}

		fixtureKey, participants := resolveFixtureKey(quote, fixtureParticipants)
		if fixtureKey == "" {
			continue
		}

		result = append(result, normalizedQuote{
			quote:                 quote,
			sourceKey:             quoteSourceKey(quote),
			marketKind:            marketKind,
			periodKey:             periodKey,
			lineKey:               lineKey,
			side:                  side,
			fixtureKey:            fixtureKey,
			decimalOdds:           decimal,
			displayOdds:           quote.Odds,
			canonicalParticipants: participants,
		})
	}

	return result
}

func normalizeOdds(quote models.OddsQuote) (float64, bool) {
	value := quote.Odds
	kind, _, _, _ := normalizeQuote(quote)

	if quote.BookmakerID == "8xbet" {
		switch {
		case value > 1:
			return value, true
		case value > 0 && kind != marketKindOverUnder && kind != marketKindHandicap:
			return value + 1, true
		case value < 0 && kind != marketKindOverUnder && kind != marketKindHandicap:
			return 1 + (1 / math.Abs(value)), true
		default:
			return 0, false
		}
	}

	if kind == marketKindOverUnder || kind == marketKindHandicap {
		return normalizeAsianOdds(value)
	}

	switch {
	case value > 1:
		return value, true
	case value > 0:
		return value + 1, true
	case value < 0:
		return 1 + (1 / math.Abs(value)), true
	default:
		return 0, false
	}
}

func normalizeAsianOdds(value float64) (float64, bool) {
	switch {
	case value > 0:
		return value + 1, true
	case value < 0:
		return 1 + (1 / math.Abs(value)), true
	default:
		return 0, false
	}
}

func groupQuotes(quotes []normalizedQuote) map[string]*quoteBucket {
	result := make(map[string]*quoteBucket)
	for _, item := range quotes {
		key := strings.Join([]string{
			item.fixtureKey,
			item.periodKey,
			string(item.marketKind),
			item.lineKey,
		}, "|")

		bucket, ok := result[key]
		if !ok {
			bucket = &quoteBucket{
				fixtureID:  item.quote.FixtureID,
				fixtureKey: item.fixtureKey,
				sport:      item.quote.Sport,
				marketName: chooseMarketName(item.quote, item.marketKind),
				marketKind: item.marketKind,
				periodKey:  item.periodKey,
				lineKey:    item.lineKey,
			}
			result[key] = bucket
		}

		bucket.quotes = append(bucket.quotes, item)
	}

	return result
}

func detectTwoWaySurebets(bucket *quoteBucket, leftSide, rightSide outcomeSide, threshold float64) []models.SurebetOpportunity {
	leftQuotes := collectBestQuotes(bucket.quotes, leftSide)
	rightQuotes := collectBestQuotes(bucket.quotes, rightSide)

	opportunities := make([]models.SurebetOpportunity, 0)
	for sourceKey, left := range leftQuotes {
		for opponentSourceKey, right := range rightQuotes {
			if sourceKey == opponentSourceKey {
				continue
			}

			inv := (1 / left.decimalOdds) + (1 / right.decimalOdds)
			if inv >= threshold {
				continue
			}

			profit := (1 - inv) * 100
			if profit <= 0 {
				continue
			}

			legs := buildLegs(left, right, inv)
			detectedAt := maxTime(left.quote.CollectedAt, right.quote.CollectedAt)
			opportunities = append(opportunities, models.SurebetOpportunity{
				ID:               opportunityID(bucket.fixtureKey, bucket.marketName, bucket.lineKey, left.quote.ID, right.quote.ID),
				FixtureID:        bucket.fixtureKey,
				Sport:            bucket.sport,
				MarketName:       bucket.marketName,
				ProfitPercentage: round(profit),
				ExpectedReturn:   round(1 - inv),
				Currency:         "",
				DetectedAt:       detectedAt,
				ExpiresAt:        detectedAt.Add(30 * time.Second),
				Legs:             legs,
			})
		}
	}

	return opportunities
}

func collectBestQuotes(quotes []normalizedQuote, targetSide outcomeSide) map[string]normalizedQuote {
	result := make(map[string]normalizedQuote)
	for _, item := range quotes {
		if item.side != targetSide {
			continue
		}

		existing, ok := result[item.sourceKey]
		if !ok || item.decimalOdds > existing.decimalOdds {
			result[item.sourceKey] = item
		}
	}
	return result
}

func buildLegs(left, right normalizedQuote, inv float64) []models.SurebetLeg {
	leftStake := (1 / left.decimalOdds) / inv
	rightStake := (1 / right.decimalOdds) / inv

	return []models.SurebetLeg{
		{
			BookmakerID: left.quote.BookmakerID,
			LobbyID:     left.quote.LobbyID,
			MarketID:    left.quote.MarketID,
			OutcomeID:   left.quote.OutcomeID,
			OutcomeName: left.quote.OutcomeName,
			Odds:        left.displayOdds,
			Stake:       round(leftStake),
		},
		{
			BookmakerID: right.quote.BookmakerID,
			LobbyID:     right.quote.LobbyID,
			MarketID:    right.quote.MarketID,
			OutcomeID:   right.quote.OutcomeID,
			OutcomeName: right.quote.OutcomeName,
			Odds:        right.displayOdds,
			Stake:       round(rightStake),
		},
	}
}

func normalizeQuote(quote models.OddsQuote) (marketKind, string, string, outcomeSide) {
	name := strings.ToLower(strings.TrimSpace(quote.OutcomeName))
	marketID := strings.ToLower(strings.TrimSpace(quote.MarketID))
	marketName := strings.ToLower(strings.TrimSpace(quote.MarketName))
	periodKey := normalizeMarketPeriod(marketID, marketName)
	line := normalizeLine(extractLine(quote.OutcomeName))

	switch {
	case strings.Contains(marketID, "over-under"),
		strings.Contains(marketID, "ta-i-xi-u"),
		strings.Contains(marketID, "o-u"),
		strings.Contains(marketName, "over/under"),
		strings.Contains(marketName, "tài xỉu"),
		strings.Contains(marketName, "tài/xỉu"),
		strings.Contains(marketName, "tài xỉu"):
		return marketKindOverUnder, periodKey, line, detectOverUnderSide(name)

	case strings.Contains(marketID, "handicap"),
		strings.Contains(marketID, "cu-o-c-cha-p"),
		strings.Contains(marketName, "handicap"),
		strings.Contains(marketName, "cược chấp"),
		strings.Contains(marketName, "chấp châu á"):
		return marketKindHandicap, periodKey, normalizeHandicapGroupLine(line), detectHandicapSide(quote, name)
	default:
		return marketKindUnknown, "", "", sideUnknown
	}
}

func normalizeMarketPeriod(marketID, marketName string) string {
	combined := strings.ToLower(strings.TrimSpace(marketID + " " + marketName))
	switch {
	case strings.Contains(combined, "1h"),
		strings.Contains(combined, "1st half"),
		strings.Contains(combined, "first half"),
		strings.Contains(combined, "hiệp 1"),
		strings.Contains(combined, "hiep 1"):
		return "1h"
	default:
		return "ft"
	}
}

func canonicalFixtureKey(quote models.OddsQuote) (string, [2]string) {
	if key, participants := canonicalFixtureKeyFromTeams(quote.HomeTeam, quote.AwayTeam); key != "" {
		return key, participants
	}

	participants := extractParticipants(quote.OutcomeName)
	if len(participants) < 2 {
		return "", [2]string{}
	}

	return canonicalFixtureKeyFromTeams(participants[0], participants[1])
}

func canonicalFixtureKeyFromTeams(homeTeam, awayTeam string) (string, [2]string) {
	left := canonicalText(homeTeam)
	right := canonicalText(awayTeam)
	if left == "" || right == "" || left == right {
		return "", [2]string{}
	}

	ordered := [2]string{left, right}
	if ordered[0] > ordered[1] {
		ordered[0], ordered[1] = ordered[1], ordered[0]
	}

	return ordered[0] + " vs " + ordered[1], ordered
}

func resolveFixtureKey(quote models.OddsQuote, inferred map[string][2]string) (string, [2]string) {
	if key, participants := canonicalFixtureKeyFromTeams(quote.HomeTeam, quote.AwayTeam); key != "" {
		return key, participants
	}

	if participants, ok := inferred[sourceFixtureKey(quote)]; ok {
		return participants[0] + " vs " + participants[1], participants
	}

	return canonicalFixtureKey(quote)
}

func inferFixtureParticipants(quotes []models.OddsQuote) map[string][2]string {
	countsByFixture := make(map[string]map[string]int)

	for _, quote := range quotes {
		if key, participants := canonicalFixtureKeyFromTeams(quote.HomeTeam, quote.AwayTeam); key != "" {
			countsByFixture[sourceFixtureKey(quote)] = map[string]int{
				participants[0]: 1,
				participants[1]: 1,
			}
			continue
		}

		candidate := participantCandidate(quote)
		if candidate == "" {
			continue
		}

		fixtureKey := sourceFixtureKey(quote)
		if countsByFixture[fixtureKey] == nil {
			countsByFixture[fixtureKey] = make(map[string]int)
		}
		countsByFixture[fixtureKey][candidate]++
	}

	result := make(map[string][2]string)
	for fixtureKey, counts := range countsByFixture {
		if len(counts) < 2 {
			continue
		}

		type participantCount struct {
			name  string
			count int
		}

		ranked := make([]participantCount, 0, len(counts))
		for name, count := range counts {
			ranked = append(ranked, participantCount{name: name, count: count})
		}

		sort.Slice(ranked, func(i, j int) bool {
			if ranked[i].count == ranked[j].count {
				return ranked[i].name < ranked[j].name
			}
			return ranked[i].count > ranked[j].count
		})

		first := ranked[0].name
		second := ranked[1].name
		if first == "" || second == "" || first == second {
			continue
		}

		ordered := [2]string{first, second}
		if ordered[0] > ordered[1] {
			ordered[0], ordered[1] = ordered[1], ordered[0]
		}

		result[fixtureKey] = ordered
	}

	return result
}

func participantCandidate(quote models.OddsQuote) string {
	cleaned := strings.TrimSpace(removeLineSuffix(quote.OutcomeName))
	cleaned = shortTagPattern.ReplaceAllString(cleaned, "")
	cleaned = strings.TrimSpace(cleaned)
	canonical := canonicalText(cleaned)
	if canonical == "" || isGenericParticipantLabel(canonical) {
		return ""
	}
	return canonical
}

func isGenericParticipantLabel(value string) bool {
	switch value {
	case "draw", "hoa", "hoa n", "even", "odd", "over", "under", "tai", "xiu":
		return true
	default:
		return false
	}
}

func extractParticipants(outcomeName string) []string {
	cleaned := strings.TrimSpace(cleanOutcomeForParticipants(outcomeName))
	if cleaned == "" {
		return nil
	}

	switch {
	case strings.Contains(cleaned, " vs "):
		parts := strings.SplitN(cleaned, " vs ", 2)
		return trimParticipants(parts)
	case strings.Contains(cleaned, " -vs- "):
		parts := strings.SplitN(cleaned, " -vs- ", 2)
		return trimParticipants(parts)
	case strings.Contains(cleaned, " - "):
		parts := strings.SplitN(cleaned, " - ", 2)
		return trimParticipants(parts)
	default:
		return nil
	}
}

func trimParticipants(parts []string) []string {
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		value := strings.TrimSpace(part)
		if value != "" {
			result = append(result, value)
		}
	}
	return result
}

func removeLineSuffix(value string) string {
	return strings.TrimSpace(linePattern.ReplaceAllString(value, ""))
}

func cleanOutcomeForParticipants(value string) string {
	trimmed := strings.TrimSpace(value)
	trimmed = outcomeSuffixPattern.ReplaceAllString(trimmed, "")
	trimmed = strings.TrimSpace(removeLineSuffix(trimmed))

	switch {
	case strings.HasSuffix(strings.ToLower(trimmed), " over"):
		return strings.TrimSpace(trimmed[:len(trimmed)-len(" over")])
	case strings.HasSuffix(strings.ToLower(trimmed), " under"):
		return strings.TrimSpace(trimmed[:len(trimmed)-len(" under")])
	default:
		return trimmed
	}
}

func canonicalText(value string) string {
	normalized := strings.ToLower(strings.TrimSpace(norm.NFKD.String(value)))
	normalized = strings.Map(func(r rune) rune {
		if unicode.Is(unicode.Mn, r) {
			return -1
		}
		return r
	}, normalized)
	normalized = whitespacePattern.ReplaceAllString(normalized, " ")
	normalized = separatorNormalizer.ReplaceAllString(normalized, " ")
	normalized = whitespacePattern.ReplaceAllString(normalized, " ")
	return strings.TrimSpace(normalized)
}

func detectOverUnderSide(name string) outcomeSide {
	switch {
	case strings.Contains(name, "over"), strings.Contains(name, "tài"), strings.Contains(name, "tài"):
		return sideOver
	case strings.Contains(name, "under"), strings.Contains(name, "xỉu"), strings.Contains(name, "xỉu"):
		return sideUnder
	default:
		return sideUnknown
	}
}

func detectHandicapSide(quote models.OddsQuote, name string) outcomeSide {
	if side := detectHandicapSideByParticipant(quote); side != sideUnknown {
		return side
	}

	switch {
	case strings.HasPrefix(name, "home "), strings.HasPrefix(name, "đội nhà "), strings.Contains(name, "(h)"):
		return sideHome
	case strings.HasPrefix(name, "away "), strings.HasPrefix(name, "đội khách "), strings.Contains(name, "(a)"):
		return sideAway
	default:
		line := extractLine(name)
		if line == "" {
			return sideUnknown
		}
		if strings.Contains(line, "-") {
			return sideHome
		}
		return sideAway
	}
}

func detectHandicapSideByParticipant(quote models.OddsQuote) outcomeSide {
	homeTeam := canonicalText(quote.HomeTeam)
	awayTeam := canonicalText(quote.AwayTeam)
	if homeTeam == "" || awayTeam == "" {
		return sideUnknown
	}

	outcomeParticipant := participantCandidate(quote)
	switch outcomeParticipant {
	case homeTeam:
		return sideHome
	case awayTeam:
		return sideAway
	default:
		return sideUnknown
	}
}

func extractLine(value string) string {
	match := linePattern.FindStringSubmatch(strings.TrimSpace(value))
	if len(match) < 2 {
		return ""
	}
	return match[1]
}

func normalizeLine(value string) string {
	if value == "" {
		return ""
	}
	return strings.TrimPrefix(strings.TrimSpace(value), "+")
}

func normalizeHandicapGroupLine(value string) string {
	line := normalizeLine(value)
	return strings.TrimPrefix(line, "-")
}

func sourceFixtureKey(quote models.OddsQuote) string {
	return strings.Join([]string{quote.BookmakerID, quote.LobbyID, quote.FixtureID}, "|")
}

func quoteSourceKey(quote models.OddsQuote) string {
	return strings.Join([]string{quote.BookmakerID, quote.LobbyID}, "|")
}

func chooseMarketName(quote models.OddsQuote, kind marketKind) string {
	if strings.TrimSpace(quote.MarketName) != "" {
		return quote.MarketName
	}
	switch kind {
	case marketKindOverUnder:
		return "Over/Under"
	case marketKindHandicap:
		return "Handicap"
	default:
		return quote.MarketID
	}
}

func opportunityID(fixtureKey, marketName, lineKey, leftID, rightID string) string {
	legs := []string{leftID, rightID}
	sort.Strings(legs)
	hash := sha1.Sum([]byte(strings.Join([]string{
		fixtureKey,
		marketName,
		lineKey,
		legs[0],
		legs[1],
	}, "|")))
	return hex.EncodeToString(hash[:])
}

func round(value float64) float64 {
	return math.Round(value*10000) / 10000
}

func maxTime(left, right time.Time) time.Time {
	if right.After(left) {
		return right
	}
	return left
}

var _ Detector = detector{}
