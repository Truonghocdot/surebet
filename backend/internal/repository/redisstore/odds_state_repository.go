package redisstore

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/redis/go-redis/v9"
	"golang.org/x/text/unicode/norm"

	"surebet/backend/internal/dto"
	"surebet/backend/internal/models"
	"surebet/backend/internal/repository"
)

const (
	// An in-play quote becomes unsafe within seconds once its stream stops.
	// Keep the board on the same freshness limit as surebet detection.
	defaultCurrentOddsWindow = 25 * time.Second
	defaultFinishedRetention = 30 * time.Minute
	defaultOverallRetention  = 24 * time.Hour
	defaultHistoryTTL        = 30 * time.Minute
	defaultSnapshotTTL       = 60 * time.Second
	defaultHistoryMaxEntries = 512
	defaultJanitorInterval   = 1 * time.Minute
)

type StreamOddsStateStore interface {
	ObserveSource(ctx context.Context, source dto.CollectorSource, observedAt time.Time) error
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
	cacheMu           sync.RWMutex
	current           map[string]map[string]models.OddsQuote
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
		current:           make(map[string]map[string]models.OddsQuote),
		finishedRetention: defaultFinishedRetention,
		overallRetention:  defaultOverallRetention,
		historyTTL:        defaultHistoryTTL,
		historyMaxEntries: defaultHistoryMaxEntries,
		snapshotTTL:       defaultSnapshotTTL,
		janitorInterval:   defaultJanitorInterval,
	}
}

func (r *OddsStateRepository) ObserveSource(
	_ context.Context,
	_ dto.CollectorSource,
	_ time.Time,
) error {
	// A heartbeat proves only that the collector connection is alive. It cannot
	// establish that any individual quote is still offered by the bookmaker.
	return nil
}

// WarmCurrentCache loads the persisted Redis state once. Hot-path reads use the
// in-process mirror so API traffic never has to transfer the full odds hash.
func (r *OddsStateRepository) WarmCurrentCache(ctx context.Context) error {
	loaded := make(map[string]map[string]models.OddsQuote)
	for _, source := range repository.MigratedOddsSources() {
		sourceRef := dto.CollectorSource{
			BookmakerID: source.BookmakerID,
			LobbyID:     source.LobbyID,
		}
		items := make(map[string]models.OddsQuote)
		var cursor uint64
		for {
			values, nextCursor, err := r.client.HScan(
				ctx,
				currentKey(sourceRef),
				cursor,
				"*",
				1000,
			).Result()
			if err != nil && !errors.Is(err, redis.Nil) {
				return err
			}
			for i := 0; i+1 < len(values); i += 2 {
				item, err := decodeOddsQuote(values[i+1])
				if err != nil {
					return err
				}
				items[values[i]] = item
			}
			if nextCursor == 0 {
				break
			}
			cursor = nextCursor
		}
		loaded[currentCacheKey(sourceRef)] = items
	}

	r.cacheMu.Lock()
	r.current = loaded
	r.cacheMu.Unlock()
	return nil
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

	if event.SnapshotID != "" {
		if err := r.registerSnapshotEntry(ctx, event.Source, event.SessionID, event.SnapshotID, logicKey); err != nil {
			return false, models.OddsQuote{}, err
		}
	}

	r.cacheMu.Lock()
	defer r.cacheMu.Unlock()
	currentItems := r.currentSourceLocked(event.Source)
	current, found := currentItems[logicKey]

	prepared, stateChanged, observationChanged := prepareQuoteWrite(current, next, found)
	if !observationChanged {
		return false, prepared, nil
	}

	if stateChanged {
		if err := r.storeQuote(ctx, event.Source, prepared); err != nil {
			return false, models.OddsQuote{}, err
		}
	}
	currentItems[logicKey] = prepared

	return stateChanged, prepared, nil
}

func (r *OddsStateRepository) ApplyQuoteUpsertBatch(
	ctx context.Context,
	events []dto.CollectorStreamQuoteUpsert,
) ([]models.OddsQuote, error) {
	if len(events) == 0 {
		return nil, nil
	}

	source := events[0].Source
	nextQuotes := make([]models.OddsQuote, len(events))

	for i := range events {
		next := buildStreamOddsQuoteFromUpsert(events[i])
		nextQuotes[i] = next
	}

	r.cacheMu.Lock()
	defer r.cacheMu.Unlock()
	currentItems := r.currentSourceLocked(source)
	pipe := r.client.TxPipeline()
	changedQuotes := make([]models.OddsQuote, 0, len(events))
	preparedQuotes := make(map[string]models.OddsQuote, len(events))
	if events[0].SnapshotID != "" {
		members := make([]any, 0, len(events))
		for _, next := range nextQuotes {
			members = append(members, logicQuoteKey(next))
		}
		snapshotKey := snapshotSetKey(source, events[0].SessionID, events[0].SnapshotID)
		pipe.SAdd(ctx, snapshotKey, members...)
		pipe.Expire(ctx, snapshotKey, r.snapshotTTL)
	}

	for i := range events {
		next := nextQuotes[i]
		logicKey := logicQuoteKey(next)
		current, found := preparedQuotes[logicKey]
		if !found {
			current, found = currentItems[logicKey]
		}

		prepared, stateChanged, observationChanged := prepareQuoteWrite(current, next, found)
		if !observationChanged {
			continue
		}
		preparedQuotes[logicKey] = prepared
		if stateChanged {
			if err := storeQuotePipeline(ctx, pipe, source, prepared, r.historyTTL, r.historyMaxEntries); err != nil {
				return nil, err
			}
			changedQuotes = append(changedQuotes, prepared)
		}
	}

	if _, err := pipe.Exec(ctx); err != nil {
		return nil, err
	}
	for logicKey, quote := range preparedQuotes {
		currentItems[logicKey] = quote
	}

	return changedQuotes, nil
}

func (r *OddsStateRepository) ApplyQuoteRemove(
	ctx context.Context,
	event dto.CollectorStreamQuoteRemove,
) (bool, models.OddsQuote, error) {
	logicKey := logicQuoteKeyFromMarkers(event.Markers)

	if event.SnapshotID != "" {
		if err := r.registerSnapshotEntry(ctx, event.Source, event.SessionID, event.SnapshotID, logicKey); err != nil {
			return false, models.OddsQuote{}, err
		}
	}

	r.cacheMu.Lock()
	defer r.cacheMu.Unlock()
	currentItems := r.currentSourceLocked(event.Source)
	current, found := currentItems[logicKey]

	if !found {
		return false, models.OddsQuote{}, nil
	}

	next := current
	next.Suspended = true
	next.CollectedAt = event.OccurredAt.UTC()
	prepared, stateChanged, observationChanged := prepareQuoteWrite(current, next, true)
	if !observationChanged {
		return false, prepared, nil
	}

	if stateChanged {
		if err := r.storeQuote(ctx, event.Source, prepared); err != nil {
			return false, models.OddsQuote{}, err
		}
	}
	currentItems[logicKey] = prepared

	return stateChanged, prepared, nil
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

	r.cacheMu.Lock()
	defer r.cacheMu.Unlock()
	currentItems := r.currentSourceLocked(source)
	changed := make([]models.OddsQuote, 0)
	pipe := r.client.TxPipeline()
	preparedQuotes := make(map[string]models.OddsQuote)
	for logicKey, item := range currentItems {
		if _, ok := seen[logicKey]; ok {
			continue
		}
		if quoteObservedAt(item).After(event.SentAt.UTC()) {
			continue
		}

		next := item
		next.Suspended = true
		next.CollectedAt = event.SentAt.UTC()
		prepared, stateChanged, observationChanged := prepareQuoteWrite(item, next, true)
		if !observationChanged {
			continue
		}
		preparedQuotes[logicKey] = prepared
		if stateChanged {
			if err := storeQuotePipeline(
				ctx,
				pipe,
				source,
				prepared,
				r.historyTTL,
				r.historyMaxEntries,
			); err != nil {
				return nil, err
			}
			changed = append(changed, prepared)
		}
	}
	pipe.Del(ctx, snapshotKey)

	if _, err := pipe.Exec(ctx); err != nil {
		return nil, err
	}
	for logicKey, quote := range preparedQuotes {
		currentItems[logicKey] = quote
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
	_ context.Context,
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
	r.cacheMu.RLock()
	for _, source := range sources {
		sourceRef := dto.CollectorSource{
			BookmakerID: source.BookmakerID,
			LobbyID:     source.LobbyID,
		}
		sourceKey := currentCacheKey(sourceRef)
		for _, item := range r.current[sourceKey] {
			if fixtureID != "" && item.FixtureID != fixtureID {
				continue
			}
			if !matchesCurrentOptions(item, now, options) {
				continue
			}
			items = append(items, item)
		}
	}
	r.cacheMu.RUnlock()

	repository.SortOddsQuotesForDisplay(items)
	return items, nil
}

func (r *OddsStateRepository) pruneExpired(
	ctx context.Context,
	now time.Time,
) error {
	r.cacheMu.Lock()
	defer r.cacheMu.Unlock()
	for _, source := range repository.MigratedOddsSources() {
		sourceRef := dto.CollectorSource{
			BookmakerID: source.BookmakerID,
			LobbyID:     source.LobbyID,
		}

		items := r.currentSourceLocked(sourceRef)
		if len(items) == 0 {
			continue
		}

		pipe := r.client.TxPipeline()
		pruned := make([]string, 0)
		for logicKey, item := range items {
			if !shouldPruneQuote(item, now, r.finishedRetention, r.overallRetention) {
				continue
			}
			pipe.HDel(ctx, currentKey(sourceRef), logicKey)
			pipe.ZRem(ctx, tsKey(sourceRef), logicKey)
			pruned = append(pruned, logicKey)
		}

		if _, err := pipe.Exec(ctx); err != nil {
			return err
		}
		for _, logicKey := range pruned {
			delete(items, logicKey)
		}
	}

	return nil
}

func (r *OddsStateRepository) currentSourceLocked(source dto.CollectorSource) map[string]models.OddsQuote {
	key := currentCacheKey(source)
	items := r.current[key]
	if items == nil {
		items = make(map[string]models.OddsQuote)
		r.current[key] = items
	}
	return items
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
		LastObservedAt: collectedAt,
		ChangedAt:      collectedAt,
	}
}

func currentKey(source dto.CollectorSource) string {
	return "odds:v2:source:" + source.BookmakerID + ":" + source.LobbyID + ":current"
}

func currentCacheKey(source dto.CollectorSource) string {
	return repository.OddsSourceKey(source.BookmakerID, source.LobbyID)
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

func prepareQuoteWrite(
	current, next models.OddsQuote,
	found bool,
) (models.OddsQuote, bool, bool) {
	observedAt := next.CollectedAt.UTC()
	if !found {
		next.LastObservedAt = observedAt
		next.ChangedAt = observedAt
		return next, true, true
	}

	currentObservedAt := quoteObservedAt(current)
	if observedAt.Before(currentObservedAt) {
		return current, false, false
	}
	if oddsQuoteStateEqual(current, next) {
		if !observedAt.After(currentObservedAt) {
			return current, false, false
		}
		current.CollectedAt = observedAt
		current.LastObservedAt = observedAt
		if current.ChangedAt.IsZero() {
			current.ChangedAt = currentObservedAt
		}
		return current, false, true
	}

	next.CollectedAt = observedAt
	next.LastObservedAt = observedAt
	next.ChangedAt = observedAt
	return next, true, true
}

func quoteObservedAt(quote models.OddsQuote) time.Time {
	if !quote.LastObservedAt.IsZero() {
		return quote.LastObservedAt.UTC()
	}
	return quote.CollectedAt.UTC()
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
	if !minCollectedAt.IsZero() && quoteObservedAt(item).Before(minCollectedAt) {
		return false
	}

	return true
}

func matchesDetectorMarket(marketMarker string) bool {
	value := strings.ToLower(strings.TrimSpace(marketMarker))
	return strings.Contains(value, "handicap") ||
		strings.Contains(value, "hdp") ||
		strings.Contains(value, "-ah") ||
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
	age := now.Sub(quoteObservedAt(item))
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
	if item.LastObservedAt.IsZero() {
		item.LastObservedAt = item.CollectedAt.UTC()
	}
	if item.ChangedAt.IsZero() {
		item.ChangedAt = item.CollectedAt.UTC()
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
