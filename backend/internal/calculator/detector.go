package calculator

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"

	"golang.org/x/text/unicode/norm"
	"surebet/backend/internal/models"
)

const (
	detectorMaxQuoteAge  = 300 * time.Second
	detectorMaxQuoteSkew = 5 * time.Minute
	arbitrageTolerance   = 1e-9
)

var (
	linePattern         = regexp.MustCompile(`([+-]?\d+(?:\.\d+)?(?:/[+-]?\d+(?:\.\d+)?)?)\s*$`)
	shortTagPattern     = regexp.MustCompile(`(?i)\s+\((h|a)\)\s*$`)
	neutralVenuePattern = regexp.MustCompile(`(?i)\s*\(\s*n\s*\)\s*$`)
	whitespacePattern   = regexp.MustCompile(`\s+`)
	separatorNormalizer = regexp.MustCompile(`[^\p{L}\p{N}]+`)
)

type detector struct {
	now func() time.Time
}

func NewDetector() Detector {
	return detector{now: time.Now}
}

func newDetector(now func() time.Time) detector {
	return detector{now: now}
}

func (d detector) Detect(_ context.Context, quotes []models.OddsQuote) ([]models.SurebetOpportunity, error) {
	now := d.now().UTC()
	normalized := normalizeQuotes(now, quotes)
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
			opportunities = append(opportunities, detectOverUnderSurebets(bucket, now)...)
		case marketKindHandicap:
			opportunities = append(opportunities, detectHandicapSurebets(bucket, now)...)
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
)

type eventIdentity struct {
	fixtureKey   string
	sport        string
	participants [2]string
}

type normalizedLine struct {
	values []float64
	key    string
}

type normalizedQuote struct {
	quote              models.OddsQuote
	sourceKey          string
	marketKind         marketKind
	periodKey          string
	line               normalizedLine
	side               outcomeSide
	participant        string
	event              eventIdentity
	decimalOdds        float64
	impliedProbability float64
}

type quoteBucket struct {
	fixtureKey string
	sport      string
	marketName string
	marketKind marketKind
	periodKey  string
	lineKey    string
	quotes     []normalizedQuote
}

func normalizeQuotes(now time.Time, quotes []models.OddsQuote) []normalizedQuote {
	result := make([]normalizedQuote, 0, len(quotes))
	for _, quote := range quotes {
		if quote.Suspended || !isFreshQuote(now, quote.CollectedAt) {
			continue
		}

		event, ok := normalizeEventIdentity(quote)
		if !ok {
			continue
		}

		decimalOdds, ok := normalizeMalayOdds(quote.Odds)
		if !ok {
			continue
		}

		marketKind, periodKey, line, side, participant, ok := normalizeQuote(quote, event)
		if !ok {
			continue
		}

		result = append(result, normalizedQuote{
			quote:              quote,
			sourceKey:          quoteSourceKey(quote),
			marketKind:         marketKind,
			periodKey:          periodKey,
			line:               line,
			side:               side,
			participant:        participant,
			event:              event,
			decimalOdds:        decimalOdds,
			impliedProbability: 1 / decimalOdds,
		})
	}

	return result
}

func isFreshQuote(now, collectedAt time.Time) bool {
	if collectedAt.IsZero() {
		return false
	}

	age := now.Sub(collectedAt.UTC())
	return age >= -detectorMaxQuoteAge && age <= detectorMaxQuoteAge
}

func normalizeEventIdentity(quote models.OddsQuote) (eventIdentity, bool) {
	sport := canonicalText(quote.Sport)
	homeTeam := canonicalParticipantText(quote.HomeTeam)
	awayTeam := canonicalParticipantText(quote.AwayTeam)
	if sport == "" || homeTeam == "" || awayTeam == "" || homeTeam == awayTeam {
		return eventIdentity{}, false
	}

	participants := [2]string{homeTeam, awayTeam}
	if participants[0] > participants[1] {
		participants[0], participants[1] = participants[1], participants[0]
	}

	event := eventIdentity{
		fixtureKey:   participants[0] + " vs " + participants[1],
		sport:        sport,
		participants: participants,
	}

	return event, true
}

func normalizeMalayOdds(value float64) (float64, bool) {
	switch {
	case math.IsNaN(value), math.IsInf(value, 0), value == 0, value < -1, value > 1:
		return 0, false
	case value > 0:
		return 1 + value, true
	default:
		return 1 + (1 / math.Abs(value)), true
	}
}

func normalizeQuote(
	quote models.OddsQuote,
	event eventIdentity,
) (marketKind, string, normalizedLine, outcomeSide, string, bool) {
	kind := normalizeMarketKind(quote.MarketID, quote.MarketName)
	if kind == marketKindUnknown {
		return marketKindUnknown, "", normalizedLine{}, sideUnknown, "", false
	}

	line, ok := parseNormalizedLine(quote.OutcomeName)
	if !ok {
		return marketKindUnknown, "", normalizedLine{}, sideUnknown, "", false
	}

	periodKey := normalizeMarketPeriod(quote.MarketID, quote.MarketName)
	name := canonicalText(quote.OutcomeName)
	switch kind {
	case marketKindOverUnder:
		side := detectOverUnderSide(name)
		if side == sideUnknown {
			return marketKindUnknown, "", normalizedLine{}, sideUnknown, "", false
		}
		return kind, periodKey, line, side, "", true
	case marketKindHandicap:
		participant := participantCandidate(quote.OutcomeName)
		if participant != event.participants[0] && participant != event.participants[1] {
			return marketKindUnknown, "", normalizedLine{}, sideUnknown, "", false
		}
		return kind, periodKey, line, sideUnknown, participant, true
	default:
		return marketKindUnknown, "", normalizedLine{}, sideUnknown, "", false
	}
}

func normalizeMarketKind(marketID, marketName string) marketKind {
	combined := canonicalText(marketID + " " + marketName)
	switch {
	case strings.Contains(combined, "over under"),
		strings.Contains(combined, "ta i xi u"),
		strings.Contains(combined, "tai xiu"),
		strings.Contains(combined, "o u"):
		return marketKindOverUnder
	case strings.Contains(combined, "handicap"),
		strings.Contains(combined, "cu o c cha p"),
		strings.Contains(combined, "cuoc chap"),
		strings.Contains(combined, "chap chau a"):
		return marketKindHandicap
	default:
		return marketKindUnknown
	}
}

func groupQuotes(quotes []normalizedQuote) map[string]*quoteBucket {
	result := make(map[string]*quoteBucket)
	for _, item := range quotes {
		key := strings.Join([]string{
			item.event.sport,
			item.event.fixtureKey,
			item.periodKey,
			string(item.marketKind),
			item.line.key,
		}, "|")

		bucket, ok := result[key]
		if !ok {
			bucket = &quoteBucket{
				fixtureKey: item.event.fixtureKey,
				sport:      item.event.sport,
				marketName: chooseMarketName(item.quote, item.marketKind),
				marketKind: item.marketKind,
				periodKey:  item.periodKey,
				lineKey:    item.line.key,
			}
			result[key] = bucket
		}

		bucket.quotes = append(bucket.quotes, item)
	}

	return result
}

func detectOverUnderSurebets(bucket *quoteBucket, now time.Time) []models.SurebetOpportunity {
	overQuotes := collectBestOverUnderQuotes(bucket.quotes, sideOver)
	underQuotes := collectBestOverUnderQuotes(bucket.quotes, sideUnder)

	opportunities := make([]models.SurebetOpportunity, 0)
	for _, over := range overQuotes {
		for _, under := range underQuotes {
			if sameSource(over, under) || !sameEvent(over.event, under.event) {
				continue
			}
			if opportunity, ok := buildOpportunity(bucket, over, under, now); ok {
				opportunities = append(opportunities, opportunity)
			}
		}
	}

	return opportunities
}

func collectBestOverUnderQuotes(quotes []normalizedQuote, targetSide outcomeSide) map[string]normalizedQuote {
	result := make(map[string]normalizedQuote)
	for _, item := range quotes {
		if item.side != targetSide {
			continue
		}

		key := sourceEventKey(item)
		existing, ok := result[key]
		if !ok || isBetterQuote(item, existing) {
			result[key] = item
		}
	}
	return result
}

func detectHandicapSurebets(bucket *quoteBucket, now time.Time) []models.SurebetOpportunity {
	bestBySourceAndParticipant := make(map[string]normalizedQuote)
	for _, item := range bucket.quotes {
		key := sourceEventKey(item) + "\x00" + item.participant
		existing, ok := bestBySourceAndParticipant[key]
		if !ok || isBetterQuote(item, existing) {
			bestBySourceAndParticipant[key] = item
		}
	}

	quotes := make([]normalizedQuote, 0, len(bestBySourceAndParticipant))
	for _, item := range bestBySourceAndParticipant {
		quotes = append(quotes, item)
	}
	sort.Slice(quotes, func(i, j int) bool {
		if quotes[i].sourceKey == quotes[j].sourceKey {
			return quotes[i].participant < quotes[j].participant
		}
		return quotes[i].sourceKey < quotes[j].sourceKey
	})

	opportunities := make([]models.SurebetOpportunity, 0)
	for i := 0; i < len(quotes); i++ {
		for j := i + 1; j < len(quotes); j++ {
			left, right := quotes[i], quotes[j]
			if sameSource(left, right) ||
				left.participant == right.participant ||
				!sameEvent(left.event, right.event) ||
				!areOppositeHandicapLines(left.line, right.line) {
				continue
			}
			if opportunity, ok := buildOpportunity(bucket, left, right, now); ok {
				opportunities = append(opportunities, opportunity)
			}
		}
	}

	return opportunities
}

func isBetterQuote(candidate, current normalizedQuote) bool {
	if candidate.decimalOdds != current.decimalOdds {
		return candidate.decimalOdds > current.decimalOdds
	}
	if !candidate.quote.CollectedAt.Equal(current.quote.CollectedAt) {
		return candidate.quote.CollectedAt.After(current.quote.CollectedAt)
	}
	return candidate.quote.ID < current.quote.ID
}

func sourceEventKey(item normalizedQuote) string {
	return strings.Join([]string{
		item.sourceKey,
		item.event.sport,
		item.event.fixtureKey,
	}, "\x00")
}

func sameEvent(left, right eventIdentity) bool {
	return left.sport == right.sport && left.fixtureKey == right.fixtureKey
}

func sameSource(left, right normalizedQuote) bool {
	return left.sourceKey == right.sourceKey
}

func areOppositeHandicapLines(left, right normalizedLine) bool {
	if len(left.values) != len(right.values) {
		return false
	}
	for index := range left.values {
		if math.Abs(left.values[index]+right.values[index]) > arbitrageTolerance {
			return false
		}
	}
	return true
}

func buildOpportunity(
	bucket *quoteBucket,
	left, right normalizedQuote,
	now time.Time,
) (models.SurebetOpportunity, bool) {
	if !hasCompatibleQuoteTimes(left.quote.CollectedAt, right.quote.CollectedAt) {
		return models.SurebetOpportunity{}, false
	}

	combinedProbability := left.impliedProbability + right.impliedProbability
	if combinedProbability >= 1-arbitrageTolerance {
		return models.SurebetOpportunity{}, false
	}

	expiresAt := minTime(
		left.quote.CollectedAt.UTC().Add(detectorMaxQuoteAge),
		right.quote.CollectedAt.UTC().Add(detectorMaxQuoteAge),
	)
	if !expiresAt.After(now) {
		return models.SurebetOpportunity{}, false
	}

	expectedReturn := (1 / combinedProbability) - 1
	return models.SurebetOpportunity{
		ID: opportunityID(
			bucket.sport,
			bucket.fixtureKey,
			bucket.marketKind,
			bucket.periodKey,
			bucket.lineKey,
			left.quote.ID,
			right.quote.ID,
		),
		FixtureID:        bucket.fixtureKey,
		Sport:            bucket.sport,
		MarketName:       bucket.marketName,
		ProfitPercentage: round(expectedReturn * 100),
		ExpectedReturn:   round(expectedReturn),
		Currency:         "",
		DetectedAt:       now,
		ExpiresAt:        expiresAt,
		Legs:             buildLegs(left, right, combinedProbability),
	}, true
}

func buildLegs(left, right normalizedQuote, combinedProbability float64) []models.SurebetLeg {
	leftStake := left.impliedProbability / combinedProbability
	rightStake := right.impliedProbability / combinedProbability

	return []models.SurebetLeg{
		{
			BookmakerID: left.quote.BookmakerID,
			LobbyID:     left.quote.LobbyID,
			MarketID:    left.quote.MarketID,
			OutcomeID:   left.quote.OutcomeID,
			OutcomeName: left.quote.OutcomeName,
			Odds:        left.quote.Odds,
			Stake:       round(leftStake),
		},
		{
			BookmakerID: right.quote.BookmakerID,
			LobbyID:     right.quote.LobbyID,
			MarketID:    right.quote.MarketID,
			OutcomeID:   right.quote.OutcomeID,
			OutcomeName: right.quote.OutcomeName,
			Odds:        right.quote.Odds,
			Stake:       round(rightStake),
		},
	}
}

func normalizeMarketPeriod(marketID, marketName string) string {
	combined := canonicalText(marketID + " " + marketName)
	switch {
	case strings.Contains(combined, "1h"),
		strings.Contains(combined, "1st half"),
		strings.Contains(combined, "first half"),
		strings.Contains(combined, "hiep 1"):
		return "1h"
	default:
		return "ft"
	}
}

func parseNormalizedLine(value string) (normalizedLine, bool) {
	raw := extractLine(value)
	if raw == "" {
		return normalizedLine{}, false
	}

	parts := strings.Split(raw, "/")
	values := make([]float64, 0, len(parts))
	for index, part := range parts {
		explicitSign := strings.HasPrefix(part, "+") || strings.HasPrefix(part, "-")
		parsed, err := strconv.ParseFloat(part, 64)
		if err != nil || math.IsNaN(parsed) || math.IsInf(parsed, 0) {
			return normalizedLine{}, false
		}
		if index > 0 && !explicitSign && values[0] < 0 {
			parsed = -parsed
		}
		values = append(values, parsed)
	}

	sort.Slice(values, func(i, j int) bool {
		left, right := math.Abs(values[i]), math.Abs(values[j])
		if left == right {
			return values[i] < values[j]
		}
		return left < right
	})

	keyParts := make([]string, 0, len(values))
	for _, line := range values {
		keyParts = append(keyParts, formatLineNumber(math.Abs(line)))
	}
	return normalizedLine{values: values, key: strings.Join(keyParts, "/")}, true
}

func formatLineNumber(value float64) string {
	if value == 0 {
		return "0"
	}
	return strconv.FormatFloat(value, 'f', -1, 64)
}

func participantCandidate(outcomeName string) string {
	cleaned := strings.TrimSpace(removeLineSuffix(outcomeName))
	cleaned = shortTagPattern.ReplaceAllString(cleaned, "")
	cleaned = strings.TrimSpace(cleaned)
	canonical := canonicalParticipantText(cleaned)
	if canonical == "" || isGenericParticipantLabel(canonical) {
		return ""
	}
	return canonical
}

func canonicalParticipantText(value string) string {
	canonical := canonicalText(neutralVenuePattern.ReplaceAllString(value, ""))
	tokens := strings.Fields(canonical)
	for len(tokens) > 0 && isGenericClubToken(tokens[0]) {
		tokens = tokens[1:]
	}
	for len(tokens) > 0 && isGenericClubToken(tokens[len(tokens)-1]) {
		tokens = tokens[:len(tokens)-1]
	}
	if len(tokens) == 0 {
		return canonical
	}
	return strings.Join(tokens, " ")
}

func isGenericParticipantLabel(value string) bool {
	switch value {
	case "draw", "hoa", "hoa n", "even", "odd", "over", "under", "tai", "xiu":
		return true
	default:
		return false
	}
}

func isGenericClubToken(value string) bool {
	switch value {
	case "fc":
		return true
	default:
		return false
	}
}

func removeLineSuffix(value string) string {
	return strings.TrimSpace(linePattern.ReplaceAllString(value, ""))
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
	case strings.Contains(name, "over"), strings.Contains(name, "tai"):
		return sideOver
	case strings.Contains(name, "under"), strings.Contains(name, "xiu"):
		return sideUnder
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

func opportunityID(
	sport, fixtureKey string,
	kind marketKind,
	periodKey, lineKey, leftID, rightID string,
) string {
	legs := []string{leftID, rightID}
	sort.Strings(legs)
	hash := sha1.Sum([]byte(strings.Join([]string{
		sport,
		fixtureKey,
		string(kind),
		periodKey,
		lineKey,
		legs[0],
		legs[1],
	}, "|")))
	return hex.EncodeToString(hash[:])
}

func minTime(left, right time.Time) time.Time {
	if right.Before(left) {
		return right
	}
	return left
}

func hasCompatibleQuoteTimes(left, right time.Time) bool {
	return absoluteDuration(left.Sub(right)) <= detectorMaxQuoteSkew
}

func absoluteDuration(value time.Duration) time.Duration {
	if value < 0 {
		return -value
	}
	return value
}

func round(value float64) float64 {
	return math.Round(value*10000) / 10000
}

var _ Detector = detector{}
