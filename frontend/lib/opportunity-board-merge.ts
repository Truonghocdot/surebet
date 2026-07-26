import type {
  OpportunityBoard,
  OpportunityBoardFixture,
  OpportunityBoardMarket,
  OpportunityBoardSource
} from "@/features/dashboard/schemas/crm-schemas";

/**
 * REST is a reconciliation source, but it can finish after a newer WebSocket
 * update. Keep the newer fixture/source/market fragments already in the cache
 * instead of letting a late response roll prices back.
 */
export function mergeOpportunityBoardsMonotonically(
  previous: OpportunityBoard | undefined,
  incoming: OpportunityBoard
): OpportunityBoard {
  if (!previous) {
    return incoming;
  }

  const previousFixtures = new Map(previous.items.map((fixture) => [fixture.id, fixture]));
  let changed = false;
  const items = incoming.items.map((fixture) => {
    const prior = previousFixtures.get(fixture.id);
    if (!prior) {
      return fixture;
    }
    const merged = mergeFixture(prior, fixture);
    changed ||= merged !== fixture;
    return merged;
  });

  return changed ? { ...incoming, items } : incoming;
}

function mergeFixture(
  previous: OpportunityBoardFixture,
  incoming: OpportunityBoardFixture
): OpportunityBoardFixture {
  const previousSources = new Map(previous.sources.map((source) => [source.id, source]));
  let preservedNewerSource = false;
  const sources = incoming.sources.map((source) => {
    const prior = previousSources.get(source.id);
    if (!prior) {
      return source;
    }
    const merged = mergeSource(prior, source);
    preservedNewerSource ||= merged !== source;
    return merged;
  });

  const fullyPreservedPrevious = sources.length === previous.sources.length &&
    sources.every((source) => previousSources.get(source.id) === source);
  if (fullyPreservedPrevious) {
    return previous;
  }

  if (!preservedNewerSource) {
    return incoming;
  }

  const latestCollectedAt = newestTimestamp(
    previous.latest_collected_at,
    incoming.latest_collected_at,
    ...sources.map((source) => source.latest_collected_at)
  );
  const latestObservedAt = newestTimestamp(
    previous.latest_observed_at,
    incoming.latest_observed_at,
    ...sources.flatMap((source) => [source.latest_observed_at, source.latest_collected_at])
  );

  return {
    ...previous,
    latest_collected_at: latestCollectedAt || previous.latest_collected_at,
    latest_observed_at: latestObservedAt || previous.latest_observed_at,
    sources
  };
}

function mergeSource(
  previous: OpportunityBoardSource,
  incoming: OpportunityBoardSource
): OpportunityBoardSource {
  if (sourceRevision(previous) > sourceRevision(incoming)) {
    return previous;
  }

  const handicap = mergeMarkets(previous.handicap, incoming.handicap);
  const overUnder = mergeMarkets(previous.over_under, incoming.over_under);
  if (handicap === incoming.handicap && overUnder === incoming.over_under) {
    return incoming;
  }

  return {
    ...incoming,
    handicap,
    over_under: overUnder
  };
}

function mergeMarkets(
  previous: OpportunityBoardMarket[],
  incoming: OpportunityBoardMarket[]
) {
  const previousMarkets = new Map(previous.map((market) => [market.id, market]));
  let changed = false;
  const markets = incoming.map((market) => {
    const prior = previousMarkets.get(market.id);
    if (!prior || marketRevision(prior) <= marketRevision(market)) {
      return market;
    }
    changed = true;
    return prior;
  });
  return changed ? markets : incoming;
}

function sourceRevision(source: OpportunityBoardSource) {
  return Math.max(
    timestamp(source.latest_observed_at || source.latest_collected_at),
    ...source.handicap.map(marketRevision),
    ...source.over_under.map(marketRevision)
  );
}

function marketRevision(market: OpportunityBoardMarket) {
  return Math.max(
    timestamp(market.observed_at),
    ...market.outcomes.map((outcome) =>
      timestamp(outcome.observed_at || outcome.collected_at)
    )
  );
}

function newestTimestamp(...values: Array<string | undefined>) {
  let latest = "";
  let latestTime = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    const parsed = timestamp(value);
    if (value && parsed > latestTime) {
      latest = value;
      latestTime = parsed;
    }
  }
  return latest;
}

function timestamp(value: string | undefined) {
  if (!value) {
    return Number.NEGATIVE_INFINITY;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}
