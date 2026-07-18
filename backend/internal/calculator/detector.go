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
	"surebet/backend/internal/logger"
	"surebet/backend/internal/models"
)

const (
	detectorMaxQuoteAge        = 300 * time.Second
	detectorMaxQuoteSkew       = 5 * time.Minute
	fixtureSimilarityThreshold = 0.40
	wordSimilarityThreshold    = 0.40
	arbitrageTolerance         = 1e-9
)

var (
	linePattern                = regexp.MustCompile(`([+-]?\d+(?:\.\d+)?(?:/[+-]?\d+(?:\.\d+)?)?)\s*$`)
	shortTagPattern            = regexp.MustCompile(`(?i)\s+\((h|a)\)\s*$`)
	parentheticalPattern       = regexp.MustCompile(`\s*\([^)]*\)`)
	danglingParenthesisPattern = regexp.MustCompile(`\s*\(.*$`)
	whitespacePattern          = regexp.MustCompile(`\s+`)
	separatorNormalizer        = regexp.MustCompile(`[^\p{L}\p{N}]+`)
	nationalTeamAgePattern     = regexp.MustCompile(`^u\d{1,2}$`)
	nationalTeamAliases        = []nationalTeamAlias{
		// Châu Âu
		{code: "eng", names: []string{"england", "anh"}},
		{code: "fra", names: []string{"france", "phap"}},
		{code: "deu", names: []string{"germany", "duc"}},
		{code: "ita", names: []string{"italy", "y"}},
		{code: "esp", names: []string{"spain", "tay ban nha"}},
		{code: "prt", names: []string{"portugal", "bo dao nha"}},
		{code: "nld", names: []string{"netherlands", "holland", "ha lan"}},
		{code: "bel", names: []string{"belgium", "bi"}},
		{code: "che", names: []string{"switzerland", "thuy si"}},
		{code: "aut", names: []string{"austria", "ao"}},
		{code: "dnk", names: []string{"denmark", "dan mach"}},
		{code: "swe", names: []string{"sweden", "thuy dien"}},
		{code: "nor", names: []string{"norway", "na uy"}},
		{code: "fin", names: []string{"finland", "phan lan"}},
		{code: "pol", names: []string{"poland", "ba lan"}},
		{code: "cze", names: []string{"czechia", "czech republic", "sec"}},
		{code: "grc", names: []string{"greece", "hy lap"}},
		{code: "tur", names: []string{"turkey", "turkiye", "tho nhi ky"}},
		{code: "rus", names: []string{"russia", "nga"}},
		{code: "ukr", names: []string{"ukraine", "ukraina"}},
		{code: "sco", names: []string{"scotland"}},
		{code: "irl", names: []string{"ireland", "republic of ireland"}},
		{code: "cro", names: []string{"croatia"}},
		{code: "srb", names: []string{"serbia"}},
		{code: "svk", names: []string{"slovakia"}},
		{code: "hun", names: []string{"hungary"}},
		{code: "rou", names: []string{"romania"}},
		{code: "alb", names: []string{"albania"}},
		{code: "svn", names: []string{"slovenia"}},
		{code: "wal", names: []string{"wales", "xu gan"}},
		{code: "bih", names: []string{"bosnia", "bosnia herzegovina", "bosnia and herzegovina"}},
		{code: "mne", names: []string{"montenegro"}},
		{code: "mkd", names: []string{"north macedonia", "macedonia"}},
		{code: "isl", names: []string{"iceland"}},
		{code: "geo", names: []string{"georgia"}},
		// Châu Mỹ
		{code: "usa", names: []string{"united states", "usa", "my"}},
		{code: "bra", names: []string{"brazil"}},
		{code: "arg", names: []string{"argentina"}},
		{code: "mex", names: []string{"mexico"}},
		{code: "col", names: []string{"colombia"}},
		{code: "chl", names: []string{"chile"}},
		{code: "per", names: []string{"peru"}},
		{code: "ury", names: []string{"uruguay"}},
		{code: "ecu", names: []string{"ecuador"}},
		{code: "ven", names: []string{"venezuela"}},
		{code: "can", names: []string{"canada"}},
		// Châu Á
		{code: "jpn", names: []string{"japan", "nhat ban"}},
		{code: "kor", names: []string{"south korea", "korea republic", "han quoc"}},
		{code: "chn", names: []string{"china", "china pr", "trung quoc"}},
		{code: "aus", names: []string{"australia", "uc"}},
		{code: "vnm", names: []string{"vietnam", "viet nam"}},
		{code: "tha", names: []string{"thailand", "thai lan"}},
		{code: "idn", names: []string{"indonesia"}},
		{code: "mys", names: []string{"malaysia"}},
		{code: "phl", names: []string{"philippines"}},
		{code: "irn", names: []string{"iran"}},
		{code: "sau", names: []string{"saudi arabia"}},
		{code: "qat", names: []string{"qatar"}},
		{code: "uae", names: []string{"united arab emirates", "uae"}},
		{code: "ind", names: []string{"india"}},
		{code: "uzb", names: []string{"uzbekistan"}},
		{code: "kaz", names: []string{"kazakhstan"}},
		{code: "prk", names: []string{"north korea", "korea dpr"}},
		// Châu Phi
		{code: "mar", names: []string{"morocco", "ma roc"}},
		{code: "nga", names: []string{"nigeria"}},
		{code: "sen", names: []string{"senegal"}},
		{code: "egy", names: []string{"egypt", "ai cap"}},
		{code: "gha", names: []string{"ghana"}},
		{code: "civ", names: []string{"ivory coast", "cote d ivoire"}},
		{code: "cmr", names: []string{"cameroon"}},
		{code: "zaf", names: []string{"south africa"}},
		{code: "tun", names: []string{"tunisia"}},
		{code: "alg", names: []string{"algeria"}},
	}
)

type nationalTeamAlias struct {
	code  string
	names []string
}

type detector struct {
	now func() time.Time
	log logger.Logger
}

func NewDetector() Detector {
	return detector{now: time.Now}
}

func NewDetectorWithLogger(log logger.Logger) Detector {
	return detector{now: time.Now, log: log}
}

func newDetector(now func() time.Time) detector {
	return detector{now: now}
}

func newDetectorWithLogger(now func() time.Time, log logger.Logger) detector {
	return detector{now: now, log: log}
}

func (d detector) Detect(_ context.Context, quotes []models.OddsQuote) ([]models.SurebetOpportunity, error) {
	now := d.now().UTC()
	stats := newDetectorRunStats()
	normalized := normalizeQuotes(now, quotes, stats)
	if len(normalized) == 0 {
		stats.logRejects(d.log)
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
			opportunities = append(opportunities, detectHandicapSurebets(bucket, now, stats)...)
		}
	}

	sort.Slice(opportunities, func(i, j int) bool {
		if opportunities[i].ProfitPercentage == opportunities[j].ProfitPercentage {
			return opportunities[i].ID < opportunities[j].ID
		}
		return opportunities[i].ProfitPercentage > opportunities[j].ProfitPercentage
	})

	stats.logRejects(d.log)
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
	matchKey     string
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
	sport      string
	marketName string
	marketKind marketKind
	periodKey  string
	lineKey    string
	quotes     []normalizedQuote
}

type detectorRejectReason string

const (
	rejectReasonMissingIdentity         detectorRejectReason = "missing_identity"
	rejectReasonUnsupportedOdds         detectorRejectReason = "unsupported_odds"
	rejectReasonParticipantMismatch     detectorRejectReason = "participant_mismatch"
	rejectReasonNonOppositeHandicapLine detectorRejectReason = "non_opposite_handicap_line"
)

var detectorRejectReasonOrder = []detectorRejectReason{
	rejectReasonMissingIdentity,
	rejectReasonUnsupportedOdds,
	rejectReasonParticipantMismatch,
	rejectReasonNonOppositeHandicapLine,
}

type detectorRunStats struct {
	rejects map[string]map[detectorRejectReason]int
}

func newDetectorRunStats() *detectorRunStats {
	return &detectorRunStats{
		rejects: make(map[string]map[detectorRejectReason]int),
	}
}

func (s *detectorRunStats) increment(sourceKey string, reason detectorRejectReason) {
	if s == nil || sourceKey == "" || reason == "" {
		return
	}

	if s.rejects[sourceKey] == nil {
		s.rejects[sourceKey] = make(map[detectorRejectReason]int)
	}
	s.rejects[sourceKey][reason]++
}

func (s *detectorRunStats) logRejects(log logger.Logger) {
	if s == nil || log == nil || len(s.rejects) == 0 {
		return
	}

	sourceKeys := make([]string, 0, len(s.rejects))
	for sourceKey := range s.rejects {
		sourceKeys = append(sourceKeys, sourceKey)
	}
	sort.Strings(sourceKeys)

	for _, sourceKey := range sourceKeys {
		counters := s.rejects[sourceKey]
		if len(counters) == 0 {
			continue
		}

		fields := make([]any, 0, 6+len(detectorRejectReasonOrder)*2)
		parts := strings.SplitN(sourceKey, "|", 2)
		if len(parts) == 2 {
			fields = append(fields,
				"bookmaker_id", parts[0],
				"lobby_id", parts[1],
			)
		} else {
			fields = append(fields, "source_key", sourceKey)
		}

		total := 0
		for _, reason := range detectorRejectReasonOrder {
			count := counters[reason]
			if count == 0 {
				continue
			}

			total += count
			fields = append(fields, string(reason), count)
		}
		if total == 0 {
			continue
		}

		fields = append(fields, "total_rejects", total)
		log.Info("detector rejected quotes", fields...)
	}
}

func normalizeQuotes(
	now time.Time,
	quotes []models.OddsQuote,
	stats *detectorRunStats,
) []normalizedQuote {
	result := make([]normalizedQuote, 0, len(quotes))
	for _, quote := range quotes {
		sourceKey := quoteSourceKey(quote)
		if quote.Suspended || !isFreshQuote(now, quote.CollectedAt) {
			continue
		}

		event, ok := normalizeEventIdentity(quote)
		if !ok {
			stats.increment(sourceKey, rejectReasonMissingIdentity)
			continue
		}

		decimalOdds, ok := normalizeMalayOdds(quote.Odds)
		if !ok {
			stats.increment(sourceKey, rejectReasonUnsupportedOdds)
			continue
		}

		marketKind, periodKey, line, side, participant, rejectReason, ok := normalizeQuote(
			quote,
			event,
		)
		if !ok {
			stats.increment(sourceKey, rejectReason)
			continue
		}

		result = append(result, normalizedQuote{
			quote:              quote,
			sourceKey:          sourceKey,
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

	assignEventMatchKeys(result)
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
) (marketKind, string, normalizedLine, outcomeSide, string, detectorRejectReason, bool) {
	kind := normalizeMarketKind(quote.MarketID, quote.MarketName)
	if kind == marketKindUnknown {
		return marketKindUnknown, "", normalizedLine{}, sideUnknown, "", "", false
	}

	line, ok := parseNormalizedLine(quote.OutcomeName)
	if !ok {
		return marketKindUnknown, "", normalizedLine{}, sideUnknown, "", "", false
	}

	periodKey := normalizeMarketPeriod(quote.MarketID, quote.MarketName)
	name := canonicalText(quote.OutcomeName)
	switch kind {
	case marketKindOverUnder:
		side := detectOverUnderSide(name)
		if side == sideUnknown {
			return marketKindUnknown, "", normalizedLine{}, sideUnknown, "", "", false
		}
		return kind, periodKey, line, side, "", "", true
	case marketKindHandicap:
		participant := participantCandidate(quote.OutcomeName)
		if participant != event.participants[0] && participant != event.participants[1] {
			return marketKindUnknown, "", normalizedLine{}, sideUnknown, "", rejectReasonParticipantMismatch, false
		}
		return kind, periodKey, line, sideUnknown, participant, "", true
	default:
		return marketKindUnknown, "", normalizedLine{}, sideUnknown, "", "", false
	}
}

func normalizeMarketKind(marketID, marketName string) marketKind {
	canonicalID := canonicalText(marketID)
	canonicalName := canonicalText(marketName)
	switch {
	case isSupportedOverUnderMarket(canonicalID, canonicalName):
		return marketKindOverUnder
	case isSupportedHandicapMarket(canonicalID, canonicalName):
		return marketKindHandicap
	default:
		return marketKindUnknown
	}
}

func isSupportedOverUnderMarket(canonicalID, canonicalName string) bool {
	switch canonicalID {
	case
		// Nhà cái Việt Nam (BTi, CMD, IBC, M8)
		"o u ou", "o u ou 1st",
		"ta i xi u ou", "ta i xi u ou 1st",
		// Format chuẩn hóa
		"ft over under", "1h over under", "2h over under",
		// Viết tắt ngắn
		"ou", "ou 1st",
		// Bet365 / Pinnacle style
		"total goals", "total goals 1st half",
		"asian total", "asian total 1st half":
		return true
	}

	switch canonicalName {
	case
		"over under", "ft over under", "1h over under", "2h over under",
		"total goals", "asian total":
		return true
	}

	return false
}

func isSupportedHandicapMarket(canonicalID, canonicalName string) bool {
	switch canonicalID {
	case
		// Nhà cái Việt Nam (BTi, CMD, IBC, M8)
		"hdp ah", "hdp ah 1st",
		"cu o c cha p ah", "cu o c cha p ah 1st",
		// Format chuẩn hóa
		"ft handicap", "1h handicap", "2h handicap",
		// Viết tắt ngắn
		"ah", "ah 1st",
		// Bet365 / Pinnacle style
		"asian handicap", "asian handicap 1st half":
		return true
	}

	switch canonicalName {
	case
		"handicap", "ft handicap", "1h handicap", "2h handicap",
		"asian handicap":
		return true
	}

	return false
}

type indexedEvent struct {
	indexKey  string
	sourceKey string
	event     eventIdentity
}

type eventCluster struct {
	key            string
	representative eventIdentity
	sources        map[string]struct{}
}

type eventMatchCandidate struct {
	eventIndex   int
	clusterIndex int
	score        float64
}

func assignEventMatchKeys(quotes []normalizedQuote) {
	eventsBySource := make(map[string]map[string]indexedEvent)
	for _, quote := range quotes {
		indexKey := sourceEventKey(quote)
		if eventsBySource[quote.sourceKey] == nil {
			eventsBySource[quote.sourceKey] = make(map[string]indexedEvent)
		}
		eventsBySource[quote.sourceKey][indexKey] = indexedEvent{
			indexKey:  indexKey,
			sourceKey: quote.sourceKey,
			event:     quote.event,
		}
	}

	sourceKeys := make([]string, 0, len(eventsBySource))
	for sourceKey := range eventsBySource {
		sourceKeys = append(sourceKeys, sourceKey)
	}
	sort.Strings(sourceKeys)

	clusters := make([]*eventCluster, 0)
	matchKeyByEvent := make(map[string]string)
	for _, sourceKey := range sourceKeys {
		events := make([]indexedEvent, 0, len(eventsBySource[sourceKey]))
		for _, event := range eventsBySource[sourceKey] {
			events = append(events, event)
		}
		sort.Slice(events, func(i, j int) bool {
			return events[i].indexKey < events[j].indexKey
		})

		candidates := make([]eventMatchCandidate, 0)
		for eventIndex, event := range events {
			for clusterIndex, cluster := range clusters {
				if event.event.sport != cluster.representative.sport {
					continue
				}
				if _, exists := cluster.sources[sourceKey]; exists {
					continue
				}
				score := fixtureSimilarity(event.event, cluster.representative)
				if score <= fixtureSimilarityThreshold {
					continue
				}
				candidates = append(candidates, eventMatchCandidate{
					eventIndex:   eventIndex,
					clusterIndex: clusterIndex,
					score:        score,
				})
			}
		}
		sort.Slice(candidates, func(i, j int) bool {
			if candidates[i].score != candidates[j].score {
				return candidates[i].score > candidates[j].score
			}
			leftEvent := events[candidates[i].eventIndex].indexKey
			rightEvent := events[candidates[j].eventIndex].indexKey
			if leftEvent != rightEvent {
				return leftEvent < rightEvent
			}
			return clusters[candidates[i].clusterIndex].key <
				clusters[candidates[j].clusterIndex].key
		})

		assignedEvents := make(map[int]struct{})
		assignedClusters := make(map[int]struct{})
		for _, candidate := range candidates {
			if _, assigned := assignedEvents[candidate.eventIndex]; assigned {
				continue
			}
			if _, assigned := assignedClusters[candidate.clusterIndex]; assigned {
				continue
			}
			event := events[candidate.eventIndex]
			cluster := clusters[candidate.clusterIndex]
			cluster.sources[sourceKey] = struct{}{}
			matchKeyByEvent[event.indexKey] = cluster.key
			assignedEvents[candidate.eventIndex] = struct{}{}
			assignedClusters[candidate.clusterIndex] = struct{}{}
		}

		for eventIndex, event := range events {
			if _, assigned := assignedEvents[eventIndex]; assigned {
				continue
			}
			clusterKey := uniqueEventClusterKey(clusters, event.event.fixtureKey)
			clusters = append(clusters, &eventCluster{
				key:            clusterKey,
				representative: event.event,
				sources:        map[string]struct{}{sourceKey: {}},
			})
			matchKeyByEvent[event.indexKey] = clusterKey
		}
	}

	for index := range quotes {
		quotes[index].event.matchKey = matchKeyByEvent[sourceEventKey(quotes[index])]
	}
}

func uniqueEventClusterKey(clusters []*eventCluster, base string) string {
	used := make(map[string]struct{}, len(clusters))
	for _, cluster := range clusters {
		used[cluster.key] = struct{}{}
	}
	if _, exists := used[base]; !exists {
		return base
	}
	for suffix := 2; ; suffix++ {
		candidate := base + " #" + strconv.Itoa(suffix)
		if _, exists := used[candidate]; !exists {
			return candidate
		}
	}
}

func groupQuotes(quotes []normalizedQuote) map[string]*quoteBucket {
	result := make(map[string]*quoteBucket)
	for _, item := range quotes {
		key := strings.Join([]string{
			item.event.sport,
			item.event.matchKey,
			item.periodKey,
			string(item.marketKind),
			item.line.key,
		}, "|")

		bucket, ok := result[key]
		if !ok {
			bucket = &quoteBucket{
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

func detectHandicapSurebets(
	bucket *quoteBucket,
	now time.Time,
	stats *detectorRunStats,
) []models.SurebetOpportunity {
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
				participantsMatch(left.participant, right.participant) ||
				!sameEvent(left.event, right.event) {
				continue
			}
			if !areOppositeHandicapLines(left.line, right.line) {
				stats.increment(left.sourceKey, rejectReasonNonOppositeHandicapLine)
				stats.increment(right.sourceKey, rejectReasonNonOppositeHandicapLine)
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
	return left.sport == right.sport && left.matchKey != "" && left.matchKey == right.matchKey
}

func fixtureSimilarity(left, right eventIdentity) float64 {
	directMatches, directValid := fixtureOrientationMatches(
		left.participants[0],
		left.participants[1],
		right.participants[0],
		right.participants[1],
	)
	reversedMatches, reversedValid := fixtureOrientationMatches(
		left.participants[0],
		left.participants[1],
		right.participants[1],
		right.participants[0],
	)
	matches := directMatches
	if !directValid || (reversedValid && reversedMatches > matches) {
		matches = reversedMatches
	}
	if (!directValid && !reversedValid) || matches == 0 {
		return 0
	}

	leftTokenCount := participantTokenCount(left.participants[0]) +
		participantTokenCount(left.participants[1])
	rightTokenCount := participantTokenCount(right.participants[0]) +
		participantTokenCount(right.participants[1])
	denominator := maxInt(leftTokenCount, rightTokenCount)
	if denominator == 0 {
		return 0
	}
	return float64(matches) / float64(denominator)
}

func fixtureOrientationMatches(leftHome, leftAway, rightHome, rightAway string) (int, bool) {
	homeMatches := participantTokenMatches(leftHome, rightHome)
	awayMatches := participantTokenMatches(leftAway, rightAway)
	if homeMatches == 0 || awayMatches == 0 {
		return 0, false
	}
	return homeMatches + awayMatches, true
}

func participantsMatch(left, right string) bool {
	denominator := maxInt(participantTokenCount(left), participantTokenCount(right))
	if denominator == 0 {
		return false
	}
	return float64(participantTokenMatches(left, right))/float64(denominator) >
		fixtureSimilarityThreshold
}

func participantTokenCount(value string) int {
	return len(strings.Fields(value))
}

func participantTokenMatches(left, right string) int {
	leftTokens := strings.Fields(left)
	rightTokens := strings.Fields(right)
	if len(leftTokens) == 0 || len(rightTokens) == 0 {
		return 0
	}

	adjacency := make([][]int, len(leftTokens))
	for leftIndex, leftToken := range leftTokens {
		for rightIndex, rightToken := range rightTokens {
			if wordsMatch(leftToken, rightToken) {
				adjacency[leftIndex] = append(adjacency[leftIndex], rightIndex)
			}
		}
	}

	matchedLeftByRight := make([]int, len(rightTokens))
	for index := range matchedLeftByRight {
		matchedLeftByRight[index] = -1
	}
	matches := 0
	for leftIndex := range leftTokens {
		seenRight := make([]bool, len(rightTokens))
		if matchParticipantToken(leftIndex, adjacency, matchedLeftByRight, seenRight) {
			matches++
		}
	}
	return matches
}

func matchParticipantToken(
	leftIndex int,
	adjacency [][]int,
	matchedLeftByRight []int,
	seenRight []bool,
) bool {
	for _, rightIndex := range adjacency[leftIndex] {
		if seenRight[rightIndex] {
			continue
		}
		seenRight[rightIndex] = true
		if matchedLeftByRight[rightIndex] == -1 ||
			matchParticipantToken(
				matchedLeftByRight[rightIndex],
				adjacency,
				matchedLeftByRight,
				seenRight,
			) {
			matchedLeftByRight[rightIndex] = leftIndex
			return true
		}
	}
	return false
}

func wordsMatch(left, right string) bool {
	if left == right {
		return true
	}
	leftRunes := []rune(left)
	rightRunes := []rune(right)
	if len(leftRunes) < 4 || len(rightRunes) < 4 {
		return false
	}
	return wordSimilarity(leftRunes, rightRunes) > wordSimilarityThreshold
}

func wordSimilarity(left, right []rune) float64 {
	denominator := maxInt(len(left), len(right))
	if denominator == 0 {
		return 1
	}
	return 1 - float64(levenshteinDistance(left, right))/float64(denominator)
}

func levenshteinDistance(left, right []rune) int {
	previous := make([]int, len(right)+1)
	for index := range previous {
		previous[index] = index
	}
	for leftIndex, leftRune := range left {
		current := make([]int, len(right)+1)
		current[0] = leftIndex + 1
		for rightIndex, rightRune := range right {
			cost := 0
			if leftRune != rightRune {
				cost = 1
			}
			current[rightIndex+1] = minInt(
				current[rightIndex]+1,
				previous[rightIndex+1]+1,
				previous[rightIndex]+cost,
			)
		}
		previous = current
	}
	return previous[len(right)]
}

func matchedFixtureKey(left, right eventIdentity) string {
	if left.matchKey != "" && left.matchKey == right.matchKey {
		return left.matchKey
	}
	if left.fixtureKey < right.fixtureKey {
		return left.fixtureKey
	}
	return right.fixtureKey
}

func maxInt(left, right int) int {
	if right > left {
		return right
	}
	return left
}

func minInt(values ...int) int {
	result := values[0]
	for _, value := range values[1:] {
		if value < result {
			result = value
		}
	}
	return result
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
	fixtureKey := matchedFixtureKey(left.event, right.event)
	return models.SurebetOpportunity{
		ID: opportunityID(
			bucket.sport,
			fixtureKey,
			bucket.marketKind,
			bucket.periodKey,
			bucket.lineKey,
			left.quote.ID,
			right.quote.ID,
		),
		FixtureID:        fixtureKey,
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
			FixtureID:   left.quote.FixtureID,
			MarketID:    left.quote.MarketID,
			OutcomeID:   left.quote.OutcomeID,
			OutcomeName: left.quote.OutcomeName,
			Odds:        left.quote.Odds,
			Stake:       round(leftStake),
		},
		{
			BookmakerID: right.quote.BookmakerID,
			LobbyID:     right.quote.LobbyID,
			FixtureID:   right.quote.FixtureID,
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
		hasCanonicalToken(combined, "1st"),
		strings.Contains(combined, "1st half"),
		strings.Contains(combined, "first half"),
		strings.Contains(combined, "hiep 1"):
		return "1h"
	case strings.Contains(combined, "2h"),
		strings.Contains(combined, "2nd half"),
		strings.Contains(combined, "second half"),
		strings.Contains(combined, "hiep 2"):
		return "2h"
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
	canonical := canonicalText(stripParticipantAnnotations(value))
	if nationalTeam, ok := canonicalNationalTeamName(canonical); ok {
		return nationalTeam
	}
	tokens := strings.Fields(canonical)
	tokens = canonicalParticipantTokens(tokens)
	if len(tokens) == 0 {
		return canonical
	}
	return strings.Join(tokens, " ")
}

func canonicalNationalTeamName(value string) (string, bool) {
	for _, country := range nationalTeamAliases {
		for _, name := range country.names {
			if value == name {
				return "nation-" + country.code, true
			}
			if !strings.HasPrefix(value, name+" ") {
				continue
			}
			qualifier, ok := canonicalNationalTeamQualifier(strings.TrimPrefix(value, name+" "))
			if ok {
				return "nation-" + country.code + " " + qualifier, true
			}
		}
	}
	return "", false
}

func canonicalNationalTeamQualifier(value string) (string, bool) {
	qualifiers := make([]string, 0)
	for _, token := range strings.Fields(value) {
		switch token {
		case "w", "woman", "women", "nu":
			qualifiers = append(qualifiers, "women")
		case "olympic", "olympics":
			qualifiers = append(qualifiers, "olympic")
		case "b", "c":
			qualifiers = append(qualifiers, token)
		default:
			if !nationalTeamAgePattern.MatchString(token) {
				return "", false
			}
			qualifiers = append(qualifiers, token)
		}
	}
	if len(qualifiers) == 0 {
		return "", false
	}
	sort.Strings(qualifiers)
	return strings.Join(qualifiers, " "), true
}

func canonicalParticipantTokens(tokens []string) []string {
	tokens = trimGenericClubAffixes(tokens)
	if len(tokens) == 0 {
		return tokens
	}

	unique := make([]string, 0, len(tokens))
	seen := make(map[string]struct{}, len(tokens))
	for _, token := range tokens {
		if strings.TrimSpace(token) == "" || isGenericClubToken(token) {
			continue
		}
		if _, ok := seen[token]; ok {
			continue
		}
		seen[token] = struct{}{}
		unique = append(unique, token)
	}

	sort.Strings(unique)
	return unique
}

func trimGenericClubAffixes(tokens []string) []string {
	for len(tokens) > 0 {
		if isGenericClubToken(tokens[0]) {
			tokens = tokens[1:]
			continue
		}
		if len(tokens) > 1 && isNumericClubPrefix(tokens[0]) && isGenericClubToken(tokens[1]) {
			tokens = tokens[2:]
			continue
		}
		break
	}

	for len(tokens) > 0 && isGenericClubToken(tokens[len(tokens)-1]) {
		tokens = tokens[:len(tokens)-1]
	}

	return tokens
}

func stripParticipantAnnotations(value string) string {
	withoutBalanced := parentheticalPattern.ReplaceAllString(value, "")
	return danglingParenthesisPattern.ReplaceAllString(withoutBalanced, "")
}

func isGenericParticipantLabel(value string) bool {
	switch value {
	case
		// Kết quả chung
		"draw", "hoa", "hoa n",
		// Chẵn/lẻ
		"even", "odd",
		// Over/Under
		"over", "under", "tai", "xiu",
		// Nhãn đội chung (một số nhà cái)
		"home", "away",
		// Nhãn số thứ tự
		"1", "2":
		return true
	default:
		return false
	}
}

func isGenericClubToken(value string) bool {
	switch value {
	case
		// Viết tắt câu lạc bộ phổ biến
		"ac", "af", "afc",
		"bk",
		"cf", "cfc", "club",
		"de",
		"ec",
		"fc", "fd", "fk", "fs",
		"if", "il", "is",
		"nk", "ns",
		"pk", "ps",
		"rc", "rfc",
		"sc", "sd", "sf", "sk", "sp", "ss",
		"team",
		"ud", "united", "utd", "us",
		"vfc":
		return true
	default:
		return false
	}
}

func isNumericClubPrefix(value string) bool {
	switch value {
	case "1":
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

func hasCanonicalToken(value, token string) bool {
	for _, current := range strings.Fields(value) {
		if current == token {
			return true
		}
	}
	return false
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
