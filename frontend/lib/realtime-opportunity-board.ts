import type {
  MatchedFixturesSnapshot,
  Opportunity,
  OpportunityBoard
} from "@/features/dashboard/schemas/crm-schemas";
import { classifyOpportunityOddsProfile } from "@/lib/opportunity-visibility";

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

export type RealtimeVerificationEvent = {
  opportunity_id: string;
  status: "confirmed" | "rejected" | "expired";
  reason?: string;
  confirmed_at?: string;
  valid_until?: string;
  opportunity?: Opportunity;
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
      opportunity_id: "",
      has_surebet: false,
      market_name: "",
      profit_percentage: 0,
      expected_return: 0,
      odds_profile: "unknown" as const,
      confirmed_at: "",
      expires_at: "",
      verification_status: "none" as const,
      valid_until: "",
      match_confidence: 0,
      match_ambiguous: false,
      latest_collected_at: fixtureLatest,
      sources: clearOpportunityLegs(sources)
    };
  });

  return {
    board: changed ? { ...board, items } : board,
    changed,
    needsReconcile: consumed.size < updates.size || changed
  };
}

export function applyRealtimeVerification(
  board: OpportunityBoard,
  event: RealtimeVerificationEvent
) {
  let changed = false;
  const items = board.items.map((fixture) => {
    const opportunity = event.opportunity;
    const matches = fixture.opportunity_id === event.opportunity_id ||
      Boolean(opportunity && fixtureContainsOpportunity(fixture, opportunity));
    if (!matches) {
      return fixture;
    }
    if (event.status !== "confirmed" || !opportunity) {
      changed = true;
      return clearFixtureOpportunity(fixture);
    }
    if (!fixtureContainsActiveOpportunityLegs(fixture, opportunity)) {
      if (fixture.opportunity_id !== event.opportunity_id) {
        return fixture;
      }
      changed = true;
      return clearFixtureOpportunity(fixture);
    }

    changed = true;
    const confirmedKeys = new Map(
      opportunity.legs.map((leg) => [
        quoteKey({
          bookmaker_id: leg.bookmaker_id,
          lobby_id: leg.lobby_id,
          fixture_id: leg.fixture_id,
          outcome_id: leg.outcome_id
        }),
        leg
      ])
    );
    const sources = fixture.sources.map((source) => ({
      ...source,
      handicap: markConfirmedMarkets(source, source.handicap, confirmedKeys),
      over_under: markConfirmedMarkets(source, source.over_under, confirmedKeys)
    }));
    return {
      ...fixture,
      opportunity_id: opportunity.id,
      market_name: opportunity.market_name,
      profit_percentage: opportunity.profit_percentage,
      expected_return: opportunity.expected_return,
      odds_profile: classifyOpportunityOddsProfile(opportunity),
      confirmed_at: opportunity.confirmed_at ?? event.confirmed_at ?? "",
      expires_at: opportunity.expires_at,
      verification_status: "confirmed" as const,
      valid_until: opportunity.valid_until ?? event.valid_until ?? "",
      match_confidence: opportunity.match_confidence ?? fixture.match_confidence,
      match_ambiguous: false,
      has_surebet: true,
      sources
    };
  });
  return changed ? { ...board, items } : board;
}

function fixtureContainsActiveOpportunityLegs(
  fixture: OpportunityBoard["items"][number],
  opportunity: Opportunity
) {
  if (opportunity.legs.length !== 2) {
    return false;
  }

  const activeQuoteKeys = new Set(
    fixture.sources.flatMap((source) =>
      [...source.handicap, ...source.over_under].flatMap((market) =>
        market.outcomes.map((outcome) =>
          quoteKey({
            bookmaker_id: source.bookmaker_id,
            lobby_id: source.lobby_id,
            fixture_id: outcome.fixture_id,
            outcome_id: outcome.outcome_id
          })
        )
      )
    )
  );
  const legKeys = opportunity.legs.map((leg) => quoteKey({
    bookmaker_id: leg.bookmaker_id,
    lobby_id: leg.lobby_id,
    fixture_id: leg.fixture_id,
    outcome_id: leg.outcome_id
  }));

  return new Set(legKeys).size === 2 &&
    legKeys.every((key) => activeQuoteKeys.has(key));
}

function clearFixtureOpportunity(
  fixture: OpportunityBoard["items"][number]
): OpportunityBoard["items"][number] {
  return {
    ...fixture,
    opportunity_id: "",
    market_name: "",
    profit_percentage: 0,
    expected_return: 0,
    odds_profile: "unknown",
    confirmed_at: "",
    expires_at: "",
    verification_status: "none",
    valid_until: "",
    has_surebet: false,
    match_confidence: 0,
    match_ambiguous: false,
    sources: clearOpportunityLegs(fixture.sources)
  };
}

function fixtureContainsOpportunity(
  fixture: OpportunityBoard["items"][number],
  opportunity: Opportunity
) {
  const sourceFixtures = new Set(
    fixture.sources.flatMap((source) =>
      [...source.handicap, ...source.over_under].flatMap((market) =>
        market.outcomes.map((outcome) =>
          [source.bookmaker_id, source.lobby_id, outcome.fixture_id].join("\u0000")
        )
      )
    )
  );
  return opportunity.legs.every((leg) =>
    sourceFixtures.has([leg.bookmaker_id, leg.lobby_id, leg.fixture_id].join("\u0000"))
  );
}

function markConfirmedMarkets(
  source: OpportunityBoard["items"][number]["sources"][number],
  markets: OpportunityBoard["items"][number]["sources"][number]["handicap"],
  confirmed: Map<string, Opportunity["legs"][number]>
) {
  return markets.map((market) => ({
    ...market,
    outcomes: market.outcomes.map((outcome) => {
      const leg = confirmed.get(quoteKey({
        bookmaker_id: source.bookmaker_id,
        lobby_id: source.lobby_id,
        fixture_id: outcome.fixture_id,
        outcome_id: outcome.outcome_id
      }));
      return {
        ...outcome,
        odds: leg?.odds ?? outcome.odds,
        is_surebet_leg: Boolean(leg),
        is_candidate_leg: outcome.is_candidate_leg || Boolean(leg)
      };
    })
  }));
}

export function applyRealtimeMatchedFixtures(
  snapshot: MatchedFixturesSnapshot,
  quotes: RealtimeOddsQuote[]
) {
  if (quotes.length === 0) {
    return snapshot;
  }

  const updates = new Map(quotes.map((quote) => [sourceFixtureKey(quote), quote]));
  let changed = false;
  let summaryLatest = snapshot.summary.latest_collected_at;
  const items = snapshot.items.map((fixture) => {
    let fixtureLatest = fixture.latest_collected_at;
    let fixtureChanged = false;
    const sources = fixture.sources.map((source) => {
      const update = updates.get(sourceFixtureKey({
        bookmaker_id: source.bookmaker_id,
        lobby_id: source.lobby_id,
        fixture_id: source.fixture_id
      }));
      if (!update) {
        return source;
      }

      changed = true;
      fixtureChanged = true;
      fixtureLatest = latestTimestamp(fixtureLatest, update.collected_at);
      summaryLatest = latestTimestamp(summaryLatest ?? "", update.collected_at);
      return {
        ...source,
        latest_collected_at: latestTimestamp(
          source.latest_collected_at,
          update.collected_at
        )
      };
    });

    return fixtureChanged
      ? { ...fixture, latest_collected_at: fixtureLatest, sources }
      : fixture;
  });

  return changed
    ? {
        ...snapshot,
        summary: {
          ...snapshot.summary,
          latest_collected_at: summaryLatest
        },
        items
      }
    : snapshot;
}

function clearOpportunityLegs(boardSources: OpportunityBoard["items"][number]["sources"]) {
  return boardSources.map((source) => ({
    ...source,
    handicap: clearMarketOpportunityLegs(source.handicap),
    over_under: clearMarketOpportunityLegs(source.over_under)
  }));
}

function clearMarketOpportunityLegs(
  markets: OpportunityBoard["items"][number]["sources"][number]["handicap"]
) {
  return markets.map((market) => ({
    ...market,
    outcomes: market.outcomes.map((outcome) => ({
      ...outcome,
      is_surebet_leg: false,
      is_candidate_leg: false
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

function sourceFixtureKey(quote: {
  bookmaker_id: string;
  lobby_id: string;
  fixture_id: string;
}) {
  return [quote.bookmaker_id, quote.lobby_id, quote.fixture_id]
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
