package redisstore

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"

	"surebet/backend/internal/dto"
	"surebet/backend/internal/models"
)

type fixtureBatchVersion struct {
	SessionID   string
	Seq         int64
	BatchID     string
	Fingerprint string
}

type coherentShadowSample struct {
	BatchID         string `json:"batch_id"`
	ObservedAtMS    int64  `json:"observed_at_ms"`
	LatencyMS       int64  `json:"latency_ms"`
	Outcomes        int    `json:"outcomes"`
	Compared        int    `json:"compared"`
	Mismatched      int    `json:"mismatched"`
	MissingLegacy   int    `json:"missing_legacy"`
	MissingCoherent int    `json:"missing_coherent"`
}

func (r *OddsStateRepository) ApplyFixtureMarketSnapshot(
	ctx context.Context,
	event dto.CollectorStreamFixtureMarketSnapshot,
) ([]models.OddsQuote, error) {
	if err := validateFixtureMarketSnapshot(event); err != nil {
		return nil, err
	}

	r.cacheMu.Lock()
	defer r.cacheMu.Unlock()

	versionKey := coherentFixtureVersionKey(event.Source, event.Fixture.FixtureID)
	currentVersion, hasVersion := r.coherentVersions[versionKey]
	if hasVersion && currentVersion.SessionID == event.SessionID && event.Seq <= currentVersion.Seq {
		return nil, nil
	}

	currentItems := r.coherentSourceLocked(event.Source)
	incoming := buildCoherentFixtureQuotes(event)
	incomingKeys := make(map[string]struct{}, len(incoming))
	prepared := make(map[string]models.OddsQuote, len(incoming))
	result := make([]models.OddsQuote, 0, len(incoming))
	pipe := r.client.TxPipeline()
	shadowSample := compareCoherentSnapshotWithLegacy(
		event,
		incoming,
		r.currentSourceLocked(event.Source),
		time.Now().UTC(),
	)
	if err := storeCoherentShadowMetricsPipeline(ctx, pipe, event.Source, shadowSample); err != nil {
		return nil, err
	}

	for _, next := range incoming {
		logicKey := coherentQuoteKey(next)
		incomingKeys[logicKey] = struct{}{}
		current, found := currentItems[logicKey]
		next = prepareCoherentQuote(current, next, found)
		encoded, err := json.Marshal(next)
		if err != nil {
			return nil, err
		}
		pipe.HSet(ctx, coherentCurrentKey(event.Source), logicKey, encoded)
		if !found || !coherentQuoteStateEqual(current, next) {
			storeCoherentHistoryPipeline(ctx, pipe, next, encoded, r.historyTTL, r.historyMaxEntries)
		}
		prepared[logicKey] = next
		result = append(result, next)
	}

	for logicKey, current := range currentItems {
		if current.FixtureID != event.Fixture.FixtureID {
			continue
		}
		if _, ok := incomingKeys[logicKey]; ok {
			continue
		}

		removed := current
		removed.Suspended = true
		removed.CollectedAt = event.ObservedAt.UTC()
		removed.LastObservedAt = event.ObservedAt.UTC()
		removed.MarketObservedAt = event.ObservedAt.UTC()
		removed.ChangedAt = event.ObservedAt.UTC()
		removed.BatchID = event.BatchID
		removed.BatchFingerprint = event.Fingerprint
		removed.BatchSeq = event.Seq
		removed.BatchSessionID = event.SessionID
		removed.SourceEventID = event.SourceEventID
		removed.CoherenceStatus = "coherent"
		encoded, err := json.Marshal(removed)
		if err != nil {
			return nil, err
		}
		pipe.HDel(ctx, coherentCurrentKey(event.Source), logicKey)
		storeCoherentHistoryPipeline(ctx, pipe, removed, encoded, r.historyTTL, r.historyMaxEntries)
		result = append(result, removed)
	}

	if _, err := pipe.Exec(ctx); err != nil {
		return nil, err
	}

	for logicKey, current := range currentItems {
		if current.FixtureID == event.Fixture.FixtureID {
			delete(currentItems, logicKey)
		}
	}
	for logicKey, quote := range prepared {
		currentItems[logicKey] = quote
	}
	r.coherentVersions[versionKey] = fixtureBatchVersion{
		SessionID:   event.SessionID,
		Seq:         event.Seq,
		BatchID:     event.BatchID,
		Fingerprint: event.Fingerprint,
	}

	sort.SliceStable(result, func(i, j int) bool {
		return coherentQuoteKey(result[i]) < coherentQuoteKey(result[j])
	})
	return result, nil
}

func (r *OddsStateRepository) ObserveFixtureBatches(
	ctx context.Context,
	event dto.CollectorStreamFixtureObservedBatch,
) error {
	if event.ProtocolVersion != 2 || event.SessionID == "" || event.ObservedAt.IsZero() {
		return errors.New("fixture_observed_batch is missing required v2 fields")
	}

	r.cacheMu.Lock()
	defer r.cacheMu.Unlock()
	currentItems := r.coherentSourceLocked(event.Source)
	pipe := r.client.TxPipeline()
	prepared := make(map[string]models.OddsQuote)

	verifiedObservations := make(map[string]dto.CollectorStreamFixtureObservation)

	for _, observation := range event.Items {
		if observation.FixtureID == "" || observation.BatchID == "" || observation.Fingerprint == "" {
			return errors.New("fixture observation is missing fixture_id, batch_id, or fingerprint")
		}
		version, ok := r.coherentVersions[coherentFixtureVersionKey(event.Source, observation.FixtureID)]
		if !ok || version.SessionID != event.SessionID || version.BatchID != observation.BatchID ||
			version.Fingerprint != observation.Fingerprint {
			continue
		}
		verifiedObservations[observation.FixtureID] = observation
		for logicKey, current := range currentItems {
			if current.FixtureID != observation.FixtureID || current.BatchID != observation.BatchID ||
				current.BatchFingerprint != observation.Fingerprint {
				continue
			}
			if !event.ObservedAt.After(current.MarketObservedAt) {
				continue
			}
			next := current
			next.CollectedAt = event.ObservedAt.UTC()
			next.LastObservedAt = event.ObservedAt.UTC()
			next.MarketObservedAt = event.ObservedAt.UTC()
			encoded, err := json.Marshal(next)
			if err != nil {
				return err
			}
			pipe.HSet(ctx, coherentCurrentKey(event.Source), logicKey, encoded)
			prepared[logicKey] = next
		}
	}

	// V1 compatibility bridge: when production reads v1 state, refresh the
	// LastObservedAt of matching v1 quotes so they don't expire after the
	// 25-second freshness window while the market is still open. This bridge
	// is automatically disabled once ODDS_STATE_PROTOCOL switches to v2.
	legacyPrepared := make(map[string]models.OddsQuote)
	if !r.useCoherentReads && len(verifiedObservations) > 0 {
		var err error
		legacyPrepared, err = r.prepareLegacyObservationBridge(
			ctx,
			pipe,
			event,
			currentItems,
			verifiedObservations,
		)
		if err != nil {
			return err
		}
	}
	storeObservationShadowMetricsPipeline(
		ctx,
		pipe,
		event.Source,
		event.ObservedAt,
		len(verifiedObservations),
		len(event.Items)-len(verifiedObservations),
		len(legacyPrepared),
	)

	if len(prepared) == 0 && len(legacyPrepared) == 0 && len(event.Items) == 0 {
		return nil
	}
	if _, err := pipe.Exec(ctx); err != nil {
		return err
	}
	for logicKey, quote := range prepared {
		currentItems[logicKey] = quote
	}
	legacyItems := r.currentSourceLocked(event.Source)
	for logicKey, quote := range legacyPrepared {
		legacyItems[logicKey] = quote
	}
	return nil
}

// prepareLegacyObservationBridge refreshes only v1 quotes which have the same
// market, outcome, price, and open state in the exact observed v2 batch. This
// prevents a fixture-level observation from reviving a removed line.
//
// The caller must hold r.cacheMu.
func (r *OddsStateRepository) prepareLegacyObservationBridge(
	ctx context.Context,
	pipe redis.Pipeliner,
	event dto.CollectorStreamFixtureObservedBatch,
	coherentItems map[string]models.OddsQuote,
	verifiedObservations map[string]dto.CollectorStreamFixtureObservation,
) (map[string]models.OddsQuote, error) {
	v1Items := r.currentSourceLocked(event.Source)
	v1Prepared := make(map[string]models.OddsQuote)
	coherentByOutcome := make(map[string]models.OddsQuote)

	for _, current := range coherentItems {
		observation, ok := verifiedObservations[current.FixtureID]
		if !ok || current.BatchSessionID != event.SessionID ||
			current.BatchID != observation.BatchID ||
			current.BatchFingerprint != observation.Fingerprint ||
			current.CoherenceStatus != "coherent" || current.Suspended || current.Odds == 0 {
			continue
		}
		coherentByOutcome[legacyBridgeOutcomeKey(current)] = current
	}

	for logicKey, current := range v1Items {
		if current.Suspended || current.Odds == 0 {
			continue
		}
		coherent, ok := coherentByOutcome[legacyBridgeOutcomeKey(current)]
		if !ok || current.Odds != coherent.Odds || current.OutcomeName != coherent.OutcomeName {
			continue
		}
		if !event.ObservedAt.After(quoteObservedAt(current)) {
			continue
		}

		next := current
		next.CollectedAt = event.ObservedAt.UTC()
		next.LastObservedAt = event.ObservedAt.UTC()
		encoded, err := json.Marshal(next)
		if err != nil {
			return nil, err
		}
		pipe.HSet(ctx, currentKey(event.Source), logicKey, encoded)
		v1Prepared[logicKey] = next
	}

	return v1Prepared, nil
}

func legacyBridgeOutcomeKey(quote models.OddsQuote) string {
	return strings.Join([]string{
		quote.FixtureID,
		quote.MarketID,
		quote.OutcomeID,
	}, "\x00")
}

func validateFixtureMarketSnapshot(event dto.CollectorStreamFixtureMarketSnapshot) error {
	if event.ProtocolVersion != 2 || event.SessionID == "" || event.Seq <= 0 ||
		event.BatchID == "" || event.Fingerprint == "" || event.ObservedAt.IsZero() || event.Fixture.FixtureID == "" ||
		event.Source.CollectorID == "" || event.Source.BookmakerID == "" || event.Source.LobbyID == "" ||
		strings.TrimSpace(event.Fixture.HomeTeam) == "" || strings.TrimSpace(event.Fixture.AwayTeam) == "" {
		return errors.New("fixture_market_snapshot is missing required v2 fields")
	}
	if !event.Complete {
		return errors.New("fixture_market_snapshot is not complete")
	}

	marketKeys := make(map[string]struct{}, len(event.Markets))
	outcomeIDs := make(map[string]struct{})
	for _, market := range event.Markets {
		marketID := strings.ToLower(strings.TrimSpace(market.MarketID))
		period := strings.ToUpper(strings.TrimSpace(market.Period))
		line := strings.TrimSpace(market.NormalizedLine)
		status := strings.ToLower(strings.TrimSpace(market.Status))
		if !isCoherentDetectorMarket(marketID) || (period != "FT" && period != "1H") ||
			!isNormalizedMarketLine(line) || (status != "open" && status != "suspended") {
			return fmt.Errorf("invalid fixture market %q", market.MarketID)
		}
		if (period == "1H") != strings.HasSuffix(marketID, "-1st") {
			return fmt.Errorf("market %q has incompatible period %q", market.MarketID, market.Period)
		}
		marketKey := marketID + "\x00" + period + "\x00" + line
		if _, exists := marketKeys[marketKey]; exists {
			return fmt.Errorf("duplicate fixture market %q", marketKey)
		}
		marketKeys[marketKey] = struct{}{}
		if len(market.Outcomes) != 2 {
			return fmt.Errorf("market %q must contain exactly two outcomes", market.MarketID)
		}

		expectedSides := expectedCoherentSides(marketID)
		seenSides := make(map[string]struct{}, 2)
		for _, outcome := range market.Outcomes {
			side := strings.ToLower(strings.TrimSpace(outcome.Side))
			if outcome.OutcomeID == "" || outcome.OutcomeName == "" || !expectedSides[side] {
				return fmt.Errorf("market %q contains an invalid outcome", market.MarketID)
			}
			if _, exists := outcomeIDs[outcome.OutcomeID]; exists {
				return fmt.Errorf("duplicate outcome_id %q", outcome.OutcomeID)
			}
			outcomeIDs[outcome.OutcomeID] = struct{}{}
			if _, exists := seenSides[side]; exists {
				return fmt.Errorf("market %q contains duplicate side %q", market.MarketID, side)
			}
			seenSides[side] = struct{}{}
			if math.IsNaN(outcome.Odds) || math.IsInf(outcome.Odds, 0) ||
				outcome.Odds == 0 || outcome.Odds < -1 || outcome.Odds > 1 ||
				strings.TrimSpace(outcome.OddsFormat) == "" {
				return fmt.Errorf("market %q contains invalid odds", market.MarketID)
			}
			if status == "open" && outcome.Suspended {
				return fmt.Errorf("open market %q contains a suspended outcome", market.MarketID)
			}
		}
		if len(seenSides) != 2 {
			return fmt.Errorf("market %q is missing an opposing side", market.MarketID)
		}
	}
	return nil
}

func isNormalizedMarketLine(line string) bool {
	value, err := strconv.ParseFloat(strings.TrimSpace(line), 64)
	return err == nil && !math.IsNaN(value) && !math.IsInf(value, 0) && value >= 0
}

func buildCoherentFixtureQuotes(event dto.CollectorStreamFixtureMarketSnapshot) []models.OddsQuote {
	quotes := make([]models.OddsQuote, 0, len(event.Markets)*2)
	observedAt := event.ObservedAt.UTC()
	fixtureMarker := buildFixtureMarker(event.Fixture.HomeTeam, event.Fixture.AwayTeam, event.Fixture.FixtureID)
	for _, market := range event.Markets {
		marketID := strings.ToLower(strings.TrimSpace(market.MarketID))
		period := strings.ToUpper(strings.TrimSpace(market.Period))
		line := strings.TrimSpace(market.NormalizedLine)
		marketOpen := strings.EqualFold(market.Status, "open")
		for _, outcome := range market.Outcomes {
			side := strings.ToLower(strings.TrimSpace(outcome.Side))
			quotes = append(quotes, models.OddsQuote{
				ID:               quoteID(event.Source.BookmakerID, event.Source.LobbyID, event.Fixture.FixtureID, marketID, outcome.OutcomeID),
				BookmakerID:      event.Source.BookmakerID,
				LobbyID:          event.Source.LobbyID,
				FixtureID:        event.Fixture.FixtureID,
				FixtureMarker:    fixtureMarker,
				HomeTeam:         strings.TrimSpace(event.Fixture.HomeTeam),
				AwayTeam:         strings.TrimSpace(event.Fixture.AwayTeam),
				LeagueName:       strings.TrimSpace(event.Fixture.LeagueName),
				Sport:            normalizeCollectorSport(event.Source, event.Fixture.Sport),
				MarketID:         marketID,
				MarketMarker:     slugText(marketID),
				MarketName:       marketID,
				OutcomeID:        outcome.OutcomeID,
				OutcomeMarker:    slugText(side + " " + line),
				OutcomeName:      strings.TrimSpace(outcome.OutcomeName),
				Odds:             outcome.Odds,
				AvailableStake:   outcome.AvailableStake,
				Suspended:        !marketOpen || outcome.Suspended,
				MatchState:       normalizeMatchState(event.Fixture.MatchState),
				EventStartAt:     parseCollectorEventStartAt(event.Fixture.EventStartAt, observedAt),
				CollectedAt:      observedAt,
				LastObservedAt:   observedAt,
				ChangedAt:        observedAt,
				ProtocolVersion:  2,
				BatchID:          event.BatchID,
				BatchFingerprint: event.Fingerprint,
				BatchSeq:         event.Seq,
				BatchSessionID:   event.SessionID,
				SourceEventID:    event.SourceEventID,
				MarketObservedAt: observedAt,
				PriceChangedAt:   observedAt,
				CoherenceStatus:  "coherent",
				MarketPeriod:     period,
				MarketLine:       line,
				MarketSide:       side,
				RawOdds:          outcome.RawOdds,
				OddsFormat:       strings.TrimSpace(outcome.OddsFormat),
			})
		}
	}
	return quotes
}

func prepareCoherentQuote(current, next models.OddsQuote, found bool) models.OddsQuote {
	if !found {
		return next
	}
	if coherentQuotePriceEqual(current, next) {
		next.PriceChangedAt = current.PriceChangedAt
		if next.PriceChangedAt.IsZero() {
			next.PriceChangedAt = current.ChangedAt
		}
	}
	if coherentQuoteStateEqual(current, next) {
		next.ChangedAt = current.ChangedAt
		if next.ChangedAt.IsZero() {
			next.ChangedAt = current.CollectedAt
		}
	}
	return next
}

func coherentQuotePriceEqual(left, right models.OddsQuote) bool {
	return left.Odds == right.Odds && left.RawOdds == right.RawOdds &&
		left.OddsFormat == right.OddsFormat
}

func coherentQuoteStateEqual(left, right models.OddsQuote) bool {
	return left.BookmakerID == right.BookmakerID && left.LobbyID == right.LobbyID &&
		left.FixtureID == right.FixtureID && left.FixtureMarker == right.FixtureMarker &&
		left.HomeTeam == right.HomeTeam && left.AwayTeam == right.AwayTeam &&
		left.LeagueName == right.LeagueName && left.Sport == right.Sport &&
		left.MarketID == right.MarketID && left.MarketPeriod == right.MarketPeriod &&
		left.MarketLine == right.MarketLine && left.MarketSide == right.MarketSide &&
		left.OutcomeID == right.OutcomeID && left.OutcomeName == right.OutcomeName &&
		left.Odds == right.Odds && left.RawOdds == right.RawOdds && left.OddsFormat == right.OddsFormat &&
		left.AvailableStake == right.AvailableStake && left.Suspended == right.Suspended &&
		left.MatchState == right.MatchState && sameOptionalTime(left.EventStartAt, right.EventStartAt)
}

func storeCoherentHistoryPipeline(
	ctx context.Context,
	pipe redis.Pipeliner,
	quote models.OddsQuote,
	encoded []byte,
	historyTTL time.Duration,
	historyMaxEntries int64,
) {
	key := coherentHistoryFixtureKey(quote.FixtureID)
	pipe.LPush(ctx, key, encoded)
	pipe.LTrim(ctx, key, 0, historyMaxEntries-1)
	pipe.Expire(ctx, key, historyTTL)
}

func coherentCurrentKey(source dto.CollectorSource) string {
	return "odds:v3:source:" + source.BookmakerID + ":" + source.LobbyID + ":current"
}

func coherentHistoryFixtureKey(fixtureID string) string {
	return "odds:v3:history:fixture:" + fixtureID
}

func coherentFixtureVersionKey(source dto.CollectorSource, fixtureID string) string {
	return currentCacheKey(source) + "\x00" + fixtureID
}

func coherentQuoteKey(quote models.OddsQuote) string {
	return strings.Join([]string{
		quote.FixtureID,
		quote.MarketID,
		quote.MarketPeriod,
		quote.MarketLine,
		quote.MarketSide,
	}, "\x00")
}

func coherentFixtureExists(items map[string]models.OddsQuote, fixtureID string) bool {
	for _, item := range items {
		if item.FixtureID == fixtureID {
			return true
		}
	}
	return false
}

func isCoherentDetectorMarket(marketID string) bool {
	switch marketID {
	case "hdp-ah", "hdp-ah-1st", "o-u-ou", "o-u-ou-1st":
		return true
	default:
		return false
	}
}

func expectedCoherentSides(marketID string) map[string]bool {
	if strings.HasPrefix(marketID, "o-u-ou") {
		return map[string]bool{"over": true, "under": true}
	}
	return map[string]bool{"home": true, "away": true}
}

func compareCoherentSnapshotWithLegacy(
	event dto.CollectorStreamFixtureMarketSnapshot,
	incoming []models.OddsQuote,
	legacy map[string]models.OddsQuote,
	now time.Time,
) coherentShadowSample {
	legacyByOutcome := make(map[string]models.OddsQuote)
	for _, quote := range legacy {
		if quote.FixtureID != event.Fixture.FixtureID || !isCoherentDetectorMarket(quote.MarketID) {
			continue
		}
		legacyByOutcome[quote.MarketID+"\x00"+quote.OutcomeID] = quote
	}
	coherentOutcomes := make(map[string]struct{}, len(incoming))
	sample := coherentShadowSample{
		BatchID:      event.BatchID,
		ObservedAtMS: event.ObservedAt.UTC().UnixMilli(),
		Outcomes:     len(incoming),
		LatencyMS:    max(now.Sub(event.ObservedAt.UTC()).Milliseconds(), 0),
	}
	for _, quote := range incoming {
		outcomeKey := quote.MarketID + "\x00" + quote.OutcomeID
		coherentOutcomes[outcomeKey] = struct{}{}
		legacyQuote, ok := legacyByOutcome[outcomeKey]
		if !ok {
			sample.MissingLegacy++
			continue
		}
		sample.Compared++
		if legacyQuote.OutcomeName != quote.OutcomeName ||
			legacyQuote.Odds != quote.Odds || legacyQuote.Suspended != quote.Suspended {
			sample.Mismatched++
		}
	}
	for outcomeKey, legacyQuote := range legacyByOutcome {
		if legacyQuote.Suspended || legacyQuote.Odds == 0 {
			continue
		}
		if _, ok := coherentOutcomes[outcomeKey]; !ok {
			sample.MissingCoherent++
		}
	}
	return sample
}

func storeCoherentShadowMetricsPipeline(
	ctx context.Context,
	pipe redis.Pipeliner,
	source dto.CollectorSource,
	sample coherentShadowSample,
) error {
	encoded, err := json.Marshal(sample)
	if err != nil {
		return err
	}
	metricsKey := coherentShadowMetricsKey(source)
	recordedAt := time.Now().UTC()
	pipe.HSetNX(ctx, metricsKey, "first_recorded_at_ms", recordedAt.UnixMilli())
	pipe.HSet(ctx, metricsKey,
		"last_recorded_at_ms", recordedAt.UnixMilli(),
		"last_batch_id", sample.BatchID,
	)
	pipe.HIncrBy(ctx, metricsKey, "accepted_batches", 1)
	pipe.HIncrBy(ctx, metricsKey, "complete_batches", 1)
	pipe.HIncrBy(ctx, metricsKey, "outcomes", int64(sample.Outcomes))
	pipe.HIncrBy(ctx, metricsKey, "compared_outcomes", int64(sample.Compared))
	pipe.HIncrBy(ctx, metricsKey, "mismatched_outcomes", int64(sample.Mismatched))
	pipe.HIncrBy(ctx, metricsKey, "missing_legacy_outcomes", int64(sample.MissingLegacy))
	pipe.HIncrBy(ctx, metricsKey, "missing_coherent_outcomes", int64(sample.MissingCoherent))
	pipe.HIncrBy(ctx, metricsKey, "latency_samples", 1)
	pipe.HIncrBy(ctx, metricsKey, "latency_total_ms", sample.LatencyMS)
	if sample.LatencyMS > 500 {
		pipe.HIncrBy(ctx, metricsKey, "latency_over_500ms", 1)
	}
	pipe.Expire(ctx, metricsKey, 30*24*time.Hour)

	windowKey := coherentShadowWindowKey(source)
	pipe.ZAdd(ctx, windowKey, redis.Z{
		Score:  float64(recordedAt.UnixMilli()),
		Member: string(encoded),
	})
	pipe.ZRemRangeByScore(
		ctx,
		windowKey,
		"-inf",
		fmt.Sprintf("%d", recordedAt.Add(-30*time.Minute).UnixMilli()),
	)
	pipe.Expire(ctx, windowKey, 24*time.Hour)
	return nil
}

func storeObservationShadowMetricsPipeline(
	ctx context.Context,
	pipe redis.Pipeliner,
	source dto.CollectorSource,
	observedAt time.Time,
	accepted, rejected, bridgedQuotes int,
) {
	metricsKey := coherentShadowMetricsKey(source)
	recordedAt := time.Now().UTC()
	pipe.HSetNX(ctx, metricsKey, "first_recorded_at_ms", recordedAt.UnixMilli())
	pipe.HSet(ctx, metricsKey,
		"last_recorded_at_ms", recordedAt.UnixMilli(),
		"last_observation_at_ms", observedAt.UTC().UnixMilli(),
	)
	pipe.HIncrBy(ctx, metricsKey, "accepted_observations", int64(accepted))
	pipe.HIncrBy(ctx, metricsKey, "rejected_observations", int64(rejected))
	pipe.HIncrBy(ctx, metricsKey, "legacy_bridge_quotes", int64(bridgedQuotes))
	pipe.Expire(ctx, metricsKey, 30*24*time.Hour)
}

func coherentShadowMetricsKey(source dto.CollectorSource) string {
	return "odds:v3:shadow:metrics:" + source.BookmakerID + ":" + source.LobbyID
}

func coherentShadowWindowKey(source dto.CollectorSource) string {
	return "odds:v3:shadow:window:" + source.BookmakerID + ":" + source.LobbyID
}
