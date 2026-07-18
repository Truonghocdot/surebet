import type { OpportunityBoard } from "@/features/dashboard/schemas/crm-schemas";

export type RealtimeOddsQuote = {
  bookmaker_id: string;
  lobby_id: string;
  fixture_id: string;
  market_id: string;
  outcome_id: string;
  odds: number;
  suspended?: boolean;
  collected_at: string;
};

type PatchResult = {
  board: OpportunityBoard;
  changed: boolean;
  needsReconcile: boolean;
};

const boardMarketIDs = new Set([
  "hdp-ah",
  "hdp-ah-1st",
  "o-u-ou",
  "o-u-ou-1st"
]);

export function applyRealtimeOddsQuotes(
  board: OpportunityBoard,
  quotes: RealtimeOddsQuote[]
): PatchResult {
  const updates = new Map<string, RealtimeOddsQuote>();
  for (const quote of quotes) {
    if (!boardMarketIDs.has(quote.market_id.trim().toLowerCase())) {
      continue;
    }
    updates.set(quoteKey(quote), quote);
  }

  if (updates.size === 0) {
    return { board, changed: false, needsReconcile: false };
  }

  const consumed = new Set<string>();
  let changed = false;
  const items = board.items.map((fixture) => {
    let fixtureChanged = false;
    let fixtureLatest = fixture.latest_collected_at;
    const sources = fixture.sources.map((source) => {
      let sourceChanged = false;
      let sourceLatest = source.latest_collected_at;
      const patchMarkets = (markets: typeof source.handicap) =>
        markets
          .map((market) => {
            const outcomes = market.outcomes.flatMap((outcome) => {
              const key = quoteKey({
                bookmaker_id: source.bookmaker_id,
                lobby_id: source.lobby_id,
                fixture_id: outcome.fixture_id,
                outcome_id: outcome.outcome_id
              });
              const update = updates.get(key);
              if (!update) {
                return [outcome];
              }

              consumed.add(key);
              changed = true;
              fixtureChanged = true;
              sourceChanged = true;
              sourceLatest = latestTimestamp(sourceLatest, update.collected_at);
              fixtureLatest = latestTimestamp(fixtureLatest, update.collected_at);
              if (update.suspended) {
                return [];
              }

              return [{
                ...outcome,
                odds: update.odds,
                collected_at: update.collected_at,
                is_surebet_leg: false
              }];
            });
            return outcomes.length > 0 ? [{ ...market, outcomes }] : [];
          })
          .flat();

      const handicap = patchMarkets(source.handicap);
      const overUnder = patchMarkets(source.over_under);
      if (!sourceChanged) {
        return source;
      }
      return {
        ...source,
        latest_collected_at: sourceLatest,
        handicap,
        over_under: overUnder
      };
    });

    if (!fixtureChanged) {
      return fixture;
    }

    return {
      ...fixture,
      has_surebet: false,
      market_name: "",
      profit_percentage: 0,
      expected_return: 0,
      odds_profile: "unknown" as const,
      confirmed_at: "",
      expires_at: "",
      latest_collected_at: fixtureLatest,
      sources: clearSurebetLegs(sources)
    };
  });

  return {
    board: changed ? { ...board, items } : board,
    changed,
    needsReconcile: consumed.size < updates.size || changed
  };
}

function clearSurebetLegs(boardSources: OpportunityBoard["items"][number]["sources"]) {
  return boardSources.map((source) => ({
    ...source,
    handicap: clearMarketSurebetLegs(source.handicap),
    over_under: clearMarketSurebetLegs(source.over_under)
  }));
}

function clearMarketSurebetLegs(
  markets: OpportunityBoard["items"][number]["sources"][number]["handicap"]
) {
  return markets.map((market) => ({
    ...market,
    outcomes: market.outcomes.map((outcome) => ({
      ...outcome,
      is_surebet_leg: false
    }))
  }));
}

function quoteKey(quote: {
  bookmaker_id: string;
  lobby_id: string;
  fixture_id: string;
  outcome_id: string;
}) {
  return [
    quote.bookmaker_id,
    quote.lobby_id,
    quote.fixture_id,
    quote.outcome_id
  ]
    .map((value) => value.trim().toLowerCase())
    .join("\u0000");
}

function latestTimestamp(current: string, next: string) {
  const currentTime = new Date(current).getTime();
  const nextTime = new Date(next).getTime();
  if (!Number.isFinite(nextTime)) {
    return current;
  }
  return !Number.isFinite(currentTime) || nextTime > currentTime ? next : current;
}
