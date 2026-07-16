package redisstore

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"time"
	"unicode"

	"github.com/redis/go-redis/v9"
	"golang.org/x/text/unicode/norm"

	"surebet/backend/internal/dto"
	"surebet/backend/internal/models"
	"surebet/backend/internal/repository"
)

const (
	defaultCurrentOddsWindow = 12 * time.Hour
	defaultFinishedRetention = 30 * time.Minute
	defaultOverallRetention  = 24 * time.Hour
	defaultHistoryTTL        = 30 * time.Minute
	defaultSnapshotTTL       = 60 * time.Second
	defaultHistoryMaxEntries = 512
	defaultJanitorInterval   = 1 * time.Minute
)

type StreamOddsStateStore interface {
	BeginSnapshot(ctx context.Context, source dto.CollectorSource, sessionID, snapshotID string) error
	ApplyQuoteUpsert(ctx context.Context, event dto.CollectorStreamQuoteUpsert) (bool, models.OddsQuote, error)
	ApplyQuoteRemove(ctx context.Context, event dto.CollectorStreamQuoteRemove) (bool, models.OddsQuote, error)
	CommitSnapshot(
		ctx context.Context,
		source dto.CollectorSource,
		sessionID string,
		event dto.CollectorStreamSnapshotCommit,
	) ([]models.OddsQuote, error)
	RunJanitor(ctx context.Context) error
}

type OddsStateRepository struct {
	client            *redis.Client
	finishedRetention time.Duration
	overallRetention  time.Duration
	historyTTL        time.Duration
	historyMaxEntries int64
	snapshotTTL       time.Duration
	janitorInterval   time.Duration
}

func NewOddsStateRepository(client *redis.Client) *OddsStateRepository {
	return &OddsStateRepository{
		client:            client,
		finishedRetention: defaultFinishedRetention,
		overallRetention:  defaultOverallRetention,
		historyTTL:        defaultHistoryTTL,
		historyMaxEntries: defaultHistoryMaxEntries,
		snapshotTTL:       defaultSnapshotTTL,
		janitorInterval:   defaultJanitorInterval,
	}
}

func (r *OddsStateRepository) ListByFixture(
	ctx context.Context,
	fixtureID string,
) ([]models.OddsQuote, error) {
	if strings.TrimSpace(fixtureID) == "" {
		return nil, nil
	}

	values, err := r.client.LRange(ctx, historyFixtureKey(fixtureID), 0, -1).Result()
	if err != nil && !errors.Is(err, redis.Nil) {
		return nil, err
	}

	items := make([]models.OddsQuote, 0, len(values))
	for _, value := range values {
		item, err := decodeOddsQuote(value)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}

	return items, nil
}

func (r *OddsStateRepository) ListCurrent(
	ctx context.Context,
	bookmakerID, lobbyID, fixtureID string,
) ([]models.OddsQuote, error) {
	return r.listCurrent(ctx, bookmakerID, lobbyID, fixtureID, currentQueryOptions{
		OnlyActiveMatches: true,
	})
}

func (r *OddsStateRepository) ListCurrentLive(
	ctx context.Context,
	bookmakerID, lobbyID, fixtureID string,
) ([]models.OddsQuote, error) {
	return r.listCurrent(ctx, bookmakerID, lobbyID, fixtureID, currentQueryOptions{
		LiveOnly:          true,
		OnlyActiveMatches: true,
	})
}

func (r *OddsStateRepository) ListCurrentDetectorCandidatesBySource(
	ctx context.Context,
	minCollectedAt time.Time,
) ([]models.OddsQuote, error) {
	return r.listCurrent(ctx, "", "", "", currentQueryOptions{
		LiveOnly:            true,
		DetectorMarketsOnly: true,
		MinCollectedAt:      minCollectedAt,
		OnlyActiveMatches:   true,
	})
}

func (r *OddsStateRepository) BeginSnapshot(
	ctx context.Context,
	source dto.CollectorSource,
	sessionID, snapshotID string,
) error {
	return r.client.Del(ctx, snapshotSetKey(source, sessionID, snapshotID)).Err()
}

func (r *OddsStateRepository) ApplyQuoteUpsert(
	ctx context.Context,
	event dto.CollectorStreamQuoteUpsert,
) (bool, models.OddsQuote, error) {
	next := buildStreamOddsQuoteFromUpsert(event)
	logicKey := logicQuoteKey(next)
	current, found, err := r.loadCurrentQuote(ctx, event.Source, logicKey)
	if err != nil {
		return false, models.OddsQuote{}, err
	}

	if event.SnapshotID != "" {
		if err := r.registerSnapshotEntry(ctx, event.Source, event.SessionID, event.SnapshotID, logicKey); err != nil {
			return false, models.OddsQuote{}, err
		}
	}

	if found && !shouldPersistQuote(current, next) {
		return false, next, nil
	}

	if err := r.storeQuote(ctx, event.Source, next); err != nil {
		return false, models.OddsQuote{}, err
	}

	return true, next, nil
}

func (r *OddsStateRepository) ApplyQuoteUpsertBatch(
	ctx context.Context,
	events []dto.CollectorStreamQuoteUpsert,
) ([]models.OddsQuote, error) {
	if len(events) == 0 {
		return nil, nil
	}

	source := events[0].Source
	logicKeys := make([]string, len(events))
	nextQuotes := make([]models.OddsQuote, len(events))

	for i, event := range events {
		next := buildStreamOddsQuoteFromUpsert(event)
		logicKeys[i] = logicQuoteKey(next)
		nextQuotes[i] = next
	}

	currentValues, err := r.client.HMGet(ctx, currentKey(source), logicKeys...).Result()
	if err != nil && !errors.Is(err, redis.Nil) {
		return nil, err
	}

	pipe := r.client.TxPipeline()
	changedQuotes := make([]models.OddsQuote, 0, len(events))

	for i, event := range events {
		next := nextQuotes[i]
		logicKey := logicKeys[i]

		var current models.OddsQuote
		found := false
		if currentValues[i] != nil {
			if strVal, ok := currentValues[i].(string); ok {
				current, err = decodeOddsQuote(strVal)
				if err == nil {
					found = true
				}
			}
		}

		if event.SnapshotID != "" {
			pipe.SAdd(ctx, snapshotSetKey(source, event.SessionID, event.SnapshotID), logicKey)
			pipe.Expire(ctx, snapshotSetKey(source, event.SessionID, event.SnapshotID), r.snapshotTTL)
		}

		if found && !shouldPersistQuote(current, next) {
			continue
		}

		if err := storeQuotePipeline(ctx, pipe, source, next, r.historyTTL, r.historyMaxEntries); err != nil {
			return nil, err
		}
		changedQuotes = append(changedQuotes, next)
	}

	if _, err := pipe.Exec(ctx); err != nil {
		return nil, err
	}

	return changedQuotes, nil
}

func (r *OddsStateRepository) ApplyQuoteRemove(
	ctx context.Context,
	event dto.CollectorStreamQuoteRemove,
) (bool, models.OddsQuote, error) {
	logicKey := logicQuoteKeyFromMarkers(event.Markers)
	current, found, err := r.loadCurrentQuote(ctx, event.Source, logicKey)
	if err != nil {
		return false, models.OddsQuote{}, err
	}

	if event.SnapshotID != "" {
		if err := r.registerSnapshotEntry(ctx, event.Source, event.SessionID, event.SnapshotID, logicKey); err != nil {
			return false, models.OddsQuote{}, err
		}
	}

	if !found {
		return false, models.OddsQuote{}, nil
	}

	next := current
	next.Suspended = true
	next.CollectedAt = event.OccurredAt.UTC()
	if !shouldPersistQuote(current, next) {
		return false, next, nil
	}

	if err := r.storeQuote(ctx, event.Source, next); err != nil {
		return false, models.OddsQuote{}, err
	}

	return true, next, nil
}

func (r *OddsStateRepository) CommitSnapshot(
	ctx context.Context,
	source dto.CollectorSource,
	sessionID string,
	event dto.CollectorStreamSnapshotCommit,
) ([]models.OddsQuote, error) {
	snapshotKey := snapshotSetKey(source, sessionID, event.SnapshotID)
	seenMembers, err := r.client.SMembers(ctx, snapshotKey).Result()
	if err != nil && !errors.Is(err, redis.Nil) {
		return nil, err
	}

	seen := make(map[string]struct{}, len(seenMembers))
	for _, member := range seenMembers {
		seen[member] = struct{}{}
	}

	currentValues, err := r.client.HGetAll(ctx, currentKey(source)).Result()
	if err != nil && !errors.Is(err, redis.Nil) {
		return nil, err
	}

	changed := make([]models.OddsQuote, 0)
	pipe := r.client.TxPipeline()
	for logicKey, rawValue := range currentValues {
		if _, ok := seen[logicKey]; ok {
			continue
		}

		item, err := decodeOddsQuote(rawValue)
		if err != nil {
			return nil, err
		}
		if item.Suspended && !item.CollectedAt.Before(event.SentAt.UTC()) {
			continue
		}

		item.Suspended = true
		item.CollectedAt = event.SentAt.UTC()
		if err := storeQuotePipeline(
			ctx,
			pipe,
			source,
			item,
			r.historyTTL,
			r.historyMaxEntries,
		); err != nil {
			return nil, err
		}
		changed = append(changed, item)
	}
	pipe.Del(ctx, snapshotKey)

	if _, err := pipe.Exec(ctx); err != nil {
		return nil, err
	}

	return changed, nil
}

func (r *OddsStateRepository) RunJanitor(ctx context.Context) error {
	ticker := time.NewTicker(r.janitorInterval)
	defer ticker.Stop()

	for {
		if err := r.pruneExpired(ctx, time.Now().UTC()); err != nil {
			return err
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}

type currentQueryOptions struct {
	LiveOnly            bool
	DetectorMarketsOnly bool
	MinCollectedAt      time.Time
	OnlyActiveMatches   bool
}

func (r *OddsStateRepository) listCurrent(
	ctx context.Context,
	bookmakerID, lobbyID, fixtureID string,
	options currentQueryOptions,
) ([]models.OddsQuote, error) {
	sources := repository.MatchOddsSources(
		bookmakerID,
		lobbyID,
		repository.MigratedOddsSources(),
	)
	if len(sources) == 0 {
		return nil, nil
	}

	now := time.Now().UTC()
	items := make([]models.OddsQuote, 0)
	for _, source := range sources {
		values, err := r.client.HVals(ctx, currentKey(dto.CollectorSource{
			BookmakerID: source.BookmakerID,
			LobbyID:     source.LobbyID,
		})).Result()
		if err != nil && !errors.Is(err, redis.Nil) {
			return nil, err
		}

		for _, value := range values {
			item, err := decodeOddsQuote(value)
			if err != nil {
				return nil, err
			}
			if fixtureID != "" && item.FixtureID != fixtureID {
				continue
			}
			if !matchesCurrentOptions(item, now, options) {
				continue
			}
			items = append(items, item)
		}
	}

	repository.SortOddsQuotesForDisplay(items)
	return items, nil
}

func (r *OddsStateRepository) pruneExpired(
	ctx context.Context,
	now time.Time,
) error {
	for _, source := range repository.MigratedOddsSources() {
		sourceRef := dto.CollectorSource{
			BookmakerID: source.BookmakerID,
			LobbyID:     source.LobbyID,
		}

		values, err := r.client.HGetAll(ctx, currentKey(sourceRef)).Result()
		if err != nil && !errors.Is(err, redis.Nil) {
			return err
		}

		if len(values) == 0 {
			continue
		}

		pipe := r.client.TxPipeline()
		for logicKey, rawValue := range values {
			item, err := decodeOddsQuote(rawValue)
			if err != nil {
				return err
			}
			if !shouldPruneQuote(item, now, r.finishedRetention, r.overallRetention) {
				continue
			}
			pipe.HDel(ctx, currentKey(sourceRef), logicKey)
			pipe.ZRem(ctx, tsKey(sourceRef), logicKey)
		}

		if _, err := pipe.Exec(ctx); err != nil {
			return err
		}
	}

	return nil
}

func (r *OddsStateRepository) loadCurrentQuote(
	ctx context.Context,
	source dto.CollectorSource,
	logicKey string,
) (models.OddsQuote, bool, error) {
	value, err := r.client.HGet(ctx, currentKey(source), logicKey).Result()
	if errors.Is(err, redis.Nil) {
		return models.OddsQuote{}, false, nil
	}
	if err != nil {
		return models.OddsQuote{}, false, err
	}

	item, err := decodeOddsQuote(value)
	if err != nil {
		return models.OddsQuote{}, false, err
	}

	return item, true, nil
}

func (r *OddsStateRepository) storeQuote(
	ctx context.Context,
	source dto.CollectorSource,
	quote models.OddsQuote,
) error {
	pipe := r.client.TxPipeline()
	if err := storeQuotePipeline(
		ctx,
		pipe,
		source,
		quote,
		r.historyTTL,
		r.historyMaxEntries,
	); err != nil {
		return err
	}
	_, err := pipe.Exec(ctx)
	return err
}

func (r *OddsStateRepository) registerSnapshotEntry(
	ctx context.Context,
	source dto.CollectorSource,
	sessionID, snapshotID, logicKey string,
) error {
	pipe := r.client.TxPipeline()
	pipe.SAdd(ctx, snapshotSetKey(source, sessionID, snapshotID), logicKey)
	pipe.Expire(ctx, snapshotSetKey(source, sessionID, snapshotID), r.snapshotTTL)
	_, err := pipe.Exec(ctx)
	return err
}

func storeQuotePipeline(
	ctx context.Context,
	pipe redis.Pipeliner,
	source dto.CollectorSource,
	quote models.OddsQuote,
	historyTTL time.Duration,
	historyMaxEntries int64,
) error {
	encoded, err := json.Marshal(quote)
	if err != nil {
		return err
	}

	logicKey := logicQuoteKey(quote)
	pipe.HSet(ctx, currentKey(source), logicKey, encoded)
	pipe.ZAdd(
		ctx,
		tsKey(source),
		redis.Z{Score: float64(quote.CollectedAt.UTC().UnixMilli()), Member: logicKey},
	)
	pipe.LPush(ctx, historyFixtureKey(quote.FixtureID), encoded)
	pipe.LTrim(ctx, historyFixtureKey(quote.FixtureID), 0, historyMaxEntries-1)
	pipe.Expire(ctx, historyFixtureKey(quote.FixtureID), historyTTL)
	return nil
}

func buildStreamOddsQuoteFromUpsert(event dto.CollectorStreamQuoteUpsert) models.OddsQuote {
	collectedAt := event.OccurredAt.UTC()
	return models.OddsQuote{
		ID:             quoteID(event.Source.BookmakerID, event.Source.LobbyID, event.RawIDs.FixtureID, event.RawIDs.MarketID, event.RawIDs.OutcomeID),
		BookmakerID:    event.Source.BookmakerID,
		LobbyID:        event.Source.LobbyID,
		FixtureID:      event.RawIDs.FixtureID,
		FixtureMarker:  firstNonEmpty(event.Markers.FixtureMarker, buildFixtureMarker(event.Quote.HomeTeam, event.Quote.AwayTeam, event.RawIDs.FixtureID)),
		HomeTeam:       strings.TrimSpace(event.Quote.HomeTeam),
		AwayTeam:       strings.TrimSpace(event.Quote.AwayTeam),
		LeagueName:     strings.TrimSpace(event.Quote.LeagueName),
		Sport:          normalizeCollectorSport(event.Source, event.Quote.Sport),
		MarketID:       event.RawIDs.MarketID,
		MarketMarker:   firstNonEmpty(event.Markers.MarketMarker, slugText(event.RawIDs.MarketID)),
		MarketName:     event.RawIDs.MarketID,
		OutcomeID:      event.RawIDs.OutcomeID,
		OutcomeMarker:  firstNonEmpty(event.Markers.OutcomeMarker, slugText(event.Quote.OutcomeName)),
		OutcomeName:    event.Quote.OutcomeName,
		Odds:           event.Quote.Odds,
		AvailableStake: event.Quote.AvailableStake,
		Suspended:      event.Quote.Suspended,
		MatchState:     normalizeMatchState(event.Quote.MatchState),
		EventStartAt:   parseCollectorEventStartAt(event.Quote.EventStartAt, collectedAt),
		CollectedAt:    collectedAt,
	}
}

func currentKey(source dto.CollectorSource) string {
	return "odds:v2:source:" + source.BookmakerID + ":" + source.LobbyID + ":current"
}

func tsKey(source dto.CollectorSource) string {
	return "odds:v2:source:" + source.BookmakerID + ":" + source.LobbyID + ":ts"
}

func snapshotSetKey(source dto.CollectorSource, sessionID, snapshotID string) string {
	return "odds:v2:source:" + source.BookmakerID + ":" + source.LobbyID + ":snapshot:" + sessionID + ":" + snapshotID
}

func historyFixtureKey(fixtureID string) string {
	return "odds:v2:history:fixture:" + fixtureID
}

func logicQuoteKey(quote models.OddsQuote) string {
	return logicQuoteKeyFromParts(
		quote.FixtureMarker,
		quote.MarketMarker,
		quote.OutcomeMarker,
	)
}

func logicQuoteKeyFromMarkers(markers dto.CollectorStreamMarkers) string {
	return logicQuoteKeyFromParts(
		markers.FixtureMarker,
		markers.MarketMarker,
		markers.OutcomeMarker,
	)
}

func logicQuoteKeyFromParts(fixtureMarker, marketMarker, outcomeMarker string) string {
	return fixtureMarker + "\x00" + marketMarker + "\x00" + outcomeMarker
}

func firstNonEmpty(primary, fallback string) string {
	if strings.TrimSpace(primary) != "" {
		return strings.TrimSpace(primary)
	}
	return strings.TrimSpace(fallback)
}

func shouldPersistQuote(current, next models.OddsQuote) bool {
	if next.CollectedAt.After(current.CollectedAt) {
		return true
	}
	if current.CollectedAt.After(next.CollectedAt) {
		return false
	}
	return !oddsQuoteStateEqual(current, next)
}

func oddsQuoteStateEqual(left, right models.OddsQuote) bool {
	return left.BookmakerID == right.BookmakerID &&
		left.LobbyID == right.LobbyID &&
		left.FixtureID == right.FixtureID &&
		left.FixtureMarker == right.FixtureMarker &&
		left.HomeTeam == right.HomeTeam &&
		left.AwayTeam == right.AwayTeam &&
		left.LeagueName == right.LeagueName &&
		left.Sport == right.Sport &&
		left.MarketID == right.MarketID &&
		left.MarketMarker == right.MarketMarker &&
		left.MarketName == right.MarketName &&
		left.OutcomeID == right.OutcomeID &&
		left.OutcomeMarker == right.OutcomeMarker &&
		left.OutcomeName == right.OutcomeName &&
		left.Odds == right.Odds &&
		left.AvailableStake == right.AvailableStake &&
		left.Suspended == right.Suspended &&
		left.MatchState == right.MatchState &&
		sameOptionalTime(left.EventStartAt, right.EventStartAt)
}

func sameOptionalTime(left, right *time.Time) bool {
	switch {
	case left == nil && right == nil:
		return true
	case left == nil || right == nil:
		return false
	default:
		return left.UTC().Equal(right.UTC())
	}
}

func matchesCurrentOptions(
	item models.OddsQuote,
	now time.Time,
	options currentQueryOptions,
) bool {
	if options.LiveOnly && (item.Suspended || item.Odds == 0) {
		return false
	}
	if options.OnlyActiveMatches &&
		item.MatchState != "upcoming" &&
		item.MatchState != "live" &&
		item.MatchState != "unknown" {
		return false
	}
	if options.DetectorMarketsOnly && !matchesDetectorMarket(item.MarketMarker) {
		return false
	}

	minCollectedAt := options.MinCollectedAt.UTC()
	if minCollectedAt.IsZero() && options.OnlyActiveMatches {
		minCollectedAt = now.Add(-defaultCurrentOddsWindow)
	}
	if !minCollectedAt.IsZero() && item.CollectedAt.Before(minCollectedAt) {
		return false
	}

	return true
}

func matchesDetectorMarket(marketMarker string) bool {
	value := strings.ToLower(strings.TrimSpace(marketMarker))
	return strings.Contains(value, "handicap") ||
		strings.Contains(value, "cu-o-c-cha-p") ||
		strings.Contains(value, "over-under") ||
		strings.Contains(value, "ta-i-xi-u") ||
		strings.Contains(value, "o-u")
}

func shouldPruneQuote(
	item models.OddsQuote,
	now time.Time,
	finishedRetention, overallRetention time.Duration,
) bool {
	age := now.Sub(item.CollectedAt.UTC())
	if age > overallRetention {
		return true
	}
	return item.MatchState == "finished" && age > finishedRetention
}

func decodeOddsQuote(value string) (models.OddsQuote, error) {
	var item models.OddsQuote
	if err := json.Unmarshal([]byte(value), &item); err != nil {
		return models.OddsQuote{}, err
	}
	return item, nil
}

func quoteID(bookmakerID, lobbyID, fixtureID, marketID, outcomeID string) string {
	sum := sha1.Sum([]byte(strings.Join([]string{
		bookmakerID,
		lobbyID,
		fixtureID,
		marketID,
		outcomeID,
	}, "|")))
	return hex.EncodeToString(sum[:])
}

func buildFixtureMarker(homeTeam, awayTeam, fixtureID string) string {
	home := slugText(homeTeam)
	away := slugText(awayTeam)
	if home != "" && away != "" {
		return home + "|" + away
	}
	return slugText(fixtureID)
}

func normalizeCollectorSport(source dto.CollectorSource, value string) string {
	sport := canonicalText(value)
	if sport != "" {
		return sport
	}

	switch source.BookmakerID + "|" + source.LobbyID {
	case "8xbet|default", "jun88|cmd":
		return "football"
	default:
		return ""
	}
}

func normalizeMatchState(value string) string {
	switch canonicalText(value) {
	case "upcoming":
		return "upcoming"
	case "live":
		return "live"
	case "finished":
		return "finished"
	default:
		return "unknown"
	}
}

func parseCollectorEventStartAt(value string, collectedAt time.Time) *time.Time {
	raw := strings.TrimSpace(value)
	if raw == "" {
		return nil
	}

	layoutsWithDate := []string{
		"01/02/2006 15:04:05",
		"01/02/2006 03:04PM",
		"01/02 03:04PM",
		"01/02 15:04",
		"2006-01-02 15:04:05",
		time.RFC3339,
	}
	for _, layout := range layoutsWithDate {
		if parsed, err := time.ParseInLocation(layout, raw, time.UTC); err == nil {
			if layout == "01/02 03:04PM" || layout == "01/02 15:04" {
				parsed = time.Date(collectedAt.Year(), parsed.Month(), parsed.Day(), parsed.Hour(), parsed.Minute(), 0, 0, time.UTC)
			}
			return &parsed
		}
	}

	layoutsTimeOnly := []string{"03:04PM", "3:04PM", "15:04"}
	for _, layout := range layoutsTimeOnly {
		if parsed, err := time.ParseInLocation(layout, raw, time.UTC); err == nil {
			resolved := time.Date(
				collectedAt.Year(),
				collectedAt.Month(),
				collectedAt.Day(),
				parsed.Hour(),
				parsed.Minute(),
				0,
				0,
				time.UTC,
			)
			return &resolved
		}
	}

	return nil
}

func canonicalText(value string) string {
	normalized := strings.ToLower(strings.TrimSpace(norm.NFKD.String(value)))
	normalized = strings.Map(func(r rune) rune {
		if unicode.Is(unicode.Mn, r) {
			return -1
		}
		return r
	}, normalized)
	normalized = strings.Map(func(r rune) rune {
		switch {
		case unicode.IsLetter(r), unicode.IsNumber(r):
			return r
		default:
			return ' '
		}
	}, normalized)
	return strings.Join(strings.Fields(normalized), " ")
}

func slugText(value string) string {
	return strings.ReplaceAll(canonicalText(value), " ", "-")
}
