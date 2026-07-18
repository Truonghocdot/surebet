import type {
  BackendOdds,
  BackendOpportunity
} from "@/lib/server-dashboard-data";
import {
  createFixtureIdentity,
  indexFixtureIdentities,
  type FixtureIdentityIndexEntry
} from "@/lib/fixture-identity";
import {
  classifyOpportunityOddsProfile,
  type OpportunityOddsProfile
} from "@/lib/opportunity-visibility";

type MarketType = "handicap" | "over_under";

type BoardOutcome = {
  fixture_id: string;
  outcome_id: string;
  outcome_name: string;
  side: string;
  odds: number;
  collected_at: string;
  is_surebet_leg: boolean;
  quote_key?: string;
};

type BoardMarket = {
  id: string;
  period: string;
  line: string;
  outcomes: BoardOutcome[];
};

type MutableSource = {
  id: string;
  bookmaker_id: string;
  lobby_id: string;
  latest_collected_at: string;
  markets: Record<MarketType, Map<string, BoardMarket>>;
};

type MutableFixture = {
  id: string;
  match_name: string;
  match_state: string;
  latest_collected_at: string;
  league_names: Set<string>;
  sources: Map<string, MutableSource>;
};

type FixtureOpportunity = {
  opportunity: BackendOpportunity;
  quoteKeys: Set<string>;
};

const CURRENT_OPPORTUNITY_AGE_MS = 15_000;

export type CurrentOpportunityBoardItem = {
  id: string;
  match_name: string;
  match_state: string;
  market_name: string;
  profit_percentage: number;
  expected_return: number;
  odds_profile: OpportunityOddsProfile;
  latest_collected_at: string;
  confirmed_at: string;
  expires_at: string;
  league_names: string[];
  has_surebet: boolean;
  sources: Array<{
    id: string;
    bookmaker_id: string;
    lobby_id: string;
    latest_collected_at: string;
    handicap: BoardMarket[];
    over_under: BoardMarket[];
  }>;
};

export function buildCurrentOpportunityBoard(
  opportunities: BackendOpportunity[],
  odds: BackendOdds[]
) {
  const currentOdds = odds.filter(isStandardBoardQuote);
  const fixtureIndex = buildFixtureIdentityIndex(currentOdds);
  const exactQuotes = new Map<string, BackendOdds>();
  const fallbackQuotes = new Map<string, BackendOdds>();
  for (const quote of currentOdds) {
    exactQuotes.set(
      quoteKey(
        quote.bookmaker_id,
        quote.lobby_id,
        quote.fixture_id,
        quote.outcome_id
      ),
      quote
    );
    fallbackQuotes.set(
      fallbackQuoteKey(
        quote.bookmaker_id,
        quote.lobby_id,
        quote.fixture_id,
        quote.market_id,
        quote.outcome_name
      ),
      quote
    );
  }

  const opportunitiesByFixture = indexCurrentOpportunities(
    opportunities,
    fixtureIndex,
    exactQuotes,
    fallbackQuotes
  );

  return groupMatchedFixtures(currentOdds, fixtureIndex)
    .filter((fixture) => fixture.sources.size >= 2)
    .map((fixture) =>
      serializeFixture(fixture, opportunitiesByFixture.get(fixture.id) ?? [])
    )
    .sort((left, right) => {
      if (left.has_surebet !== right.has_surebet) {
        return left.has_surebet ? -1 : 1;
      }
      if (right.profit_percentage !== left.profit_percentage) {
        return right.profit_percentage - left.profit_percentage;
      }
      return (
        new Date(right.latest_collected_at).getTime() -
        new Date(left.latest_collected_at).getTime()
      );
    });
}

function indexCurrentOpportunities(
  opportunities: BackendOpportunity[],
  fixtureIndex: Map<string, string>,
  exactQuotes: Map<string, BackendOdds>,
  fallbackQuotes: Map<string, BackendOdds>
): Map<string, FixtureOpportunity[]> {
  const result = new Map<string, FixtureOpportunity[]>();
  const now = Date.now();

  for (const opportunity of opportunities) {
    if (!isCurrentOpportunity(opportunity, now) || opportunity.legs.length !== 2) {
      continue;
    }

    const quotes = opportunity.legs.map(
      (leg) =>
        exactQuotes.get(
          quoteKey(leg.bookmaker_id, leg.lobby_id, leg.fixture_id, leg.outcome_id)
        ) ??
        fallbackQuotes.get(
          fallbackQuoteKey(
            leg.bookmaker_id,
            leg.lobby_id,
            leg.fixture_id,
            leg.market_id,
            leg.outcome_name
          )
        )
    );
    if (quotes.some((quote) => !quote)) {
      continue;
    }

    const resolvedQuotes = quotes as BackendOdds[];
    const fixtureIDs = new Set(
      resolvedQuotes.map((quote) => fixtureIndex.get(sourceFixtureIdentityID(quote)))
    );
    if (fixtureIDs.size !== 1 || fixtureIDs.has(undefined)) {
      continue;
    }

    const fixtureID = Array.from(fixtureIDs)[0];
    if (!fixtureID) {
      continue;
    }
    const indexed = result.get(fixtureID) ?? [];
    indexed.push({
      opportunity,
      quoteKeys: new Set(resolvedQuotes.map(currentQuoteKey))
    });
    result.set(fixtureID, indexed);
  }

  return result;
}

function groupMatchedFixtures(
  odds: BackendOdds[],
  fixtureIndex: Map<string, string>
) {
  const fixtures = new Map<string, MutableFixture>();

  for (const quote of odds) {
    const fixtureID = fixtureIndex.get(sourceFixtureIdentityID(quote));
    const marketType = inferMarketType(quote.market_type, quote.market_id);
    if (!fixtureID || !marketType) {
      continue;
    }

    const sourceID = sourceIDForQuote(quote);
    const fixture = fixtures.get(fixtureID) ?? {
      id: fixtureID,
      match_name: displayMatchName(quote),
      match_state: quote.match_state || "unknown",
      latest_collected_at: quote.collected_at,
      league_names: new Set<string>(),
      sources: new Map<string, MutableSource>()
    };
    fixture.match_state = pickMatchStateValues(fixture.match_state, quote.match_state);
    fixture.latest_collected_at = latestTimestamp(
      fixture.latest_collected_at,
      quote.collected_at
    );
    if (quote.league_name.trim()) {
      fixture.league_names.add(quote.league_name.trim());
    }

    const source = fixture.sources.get(sourceID) ?? {
      id: sourceID,
      bookmaker_id: quote.bookmaker_id,
      lobby_id: quote.lobby_id,
      latest_collected_at: quote.collected_at,
      markets: {
        handicap: new Map<string, BoardMarket>(),
        over_under: new Map<string, BoardMarket>()
      }
    };
    source.latest_collected_at = latestTimestamp(
      source.latest_collected_at,
      quote.collected_at
    );

    const period = quote.period || inferPeriod(quote.market_id);
    const line = quote.line || inferLine(quote.outcome_name);
    const marketKey = `${period}\u0000${marketType}\u0000${line}`;
    const market = source.markets[marketType].get(marketKey) ?? {
      id: `${fixtureID}\u0000${sourceID}\u0000${marketKey}`,
      period,
      line,
      outcomes: []
    };
    const outcome: BoardOutcome = {
      fixture_id: quote.fixture_id,
      outcome_id: quote.outcome_id,
      outcome_name: quote.outcome_name,
      side: quote.side || inferSide(marketType, quote.outcome_name),
      odds: quote.odds,
      collected_at: quote.collected_at,
      is_surebet_leg: false,
      quote_key: currentQuoteKey(quote)
    };
    const outcomeIndex = market.outcomes.findIndex(
      (current) => current.outcome_id === outcome.outcome_id
    );
    if (outcomeIndex >= 0) {
      market.outcomes[outcomeIndex] = outcome;
    } else {
      market.outcomes.push(outcome);
    }
    source.markets[marketType].set(marketKey, market);
    fixture.sources.set(sourceID, source);
    fixtures.set(fixtureID, fixture);
  }

  return Array.from(fixtures.values());
}

function serializeFixture(
  fixture: MutableFixture,
  fixtureOpportunities: FixtureOpportunity[]
): CurrentOpportunityBoardItem {
  const bestOpportunity = fixtureOpportunities
    .map((item) => item.opportunity)
    .sort((left, right) => right.profit_percentage - left.profit_percentage)[0];
  const surebetQuoteKeys = new Set(
    fixtureOpportunities.flatMap((item) => Array.from(item.quoteKeys))
  );

  return {
    id: fixture.id,
    match_name: fixture.match_name,
    match_state: fixture.match_state,
    market_name: bestOpportunity?.market_name ?? "",
    profit_percentage: bestOpportunity?.profit_percentage ?? 0,
    expected_return: bestOpportunity?.expected_return ?? 0,
    odds_profile: bestOpportunity
      ? classifyOpportunityOddsProfile(bestOpportunity)
      : "unknown",
    latest_collected_at: fixture.latest_collected_at,
    confirmed_at: bestOpportunity?.detected_at ?? "",
    expires_at: bestOpportunity?.expires_at ?? "",
    league_names: Array.from(fixture.league_names).sort((left, right) =>
      left.localeCompare(right)
    ),
    has_surebet: Boolean(bestOpportunity),
    sources: Array.from(fixture.sources.values())
      .map((source) => ({
        id: source.id,
        bookmaker_id: source.bookmaker_id,
        lobby_id: source.lobby_id,
        latest_collected_at: source.latest_collected_at,
        handicap: serializeMarkets(source.markets.handicap, surebetQuoteKeys),
        over_under: serializeMarkets(source.markets.over_under, surebetQuoteKeys)
      }))
      .sort((left, right) => left.id.localeCompare(right.id))
  };
}

function serializeMarkets(
  markets: Map<string, BoardMarket>,
  surebetQuoteKeys: Set<string>
) {
  return Array.from(markets.values()).map((market) => ({
    ...market,
    outcomes: [...market.outcomes]
      .map(({ quote_key: quoteKeyValue, ...outcome }) => ({
        ...outcome,
        is_surebet_leg: Boolean(quoteKeyValue && surebetQuoteKeys.has(quoteKeyValue))
      }))
      .sort((left, right) => left.outcome_name.localeCompare(right.outcome_name))
  }));
}

function inferMarketType(_value: string, marketID: string): MarketType | null {
  const normalized = marketID.trim().toLowerCase();
  if (normalized === "hdp-ah" || normalized === "hdp-ah-1st") {
    return "handicap";
  }
  if (normalized === "o-u-ou" || normalized === "o-u-ou-1st") {
    return "over_under";
  }
  return null;
}

function inferPeriod(marketID: string) {
  return /(?:1st|1h|first[-_ ]?half)/i.test(marketID) ? "1H" : "FT";
}

function inferLine(outcomeName: string) {
  const match = outcomeName.match(/([+-]?\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)?)\s*$/);
  return match?.[1]?.replace(/^[+-]/, "") ?? "";
}

function inferSide(marketType: MarketType, outcomeName: string) {
  if (marketType === "over_under") {
    if (/\b(over|tai)\b/i.test(outcomeName)) {
      return "over";
    }
    if (/\b(under|xiu)\b/i.test(outcomeName)) {
      return "under";
    }
  }
  return "selection";
}

function quoteKey(
  bookmakerID: string,
  lobbyID: string,
  fixtureID: string,
  outcomeID: string
) {
  return [bookmakerID, lobbyID, fixtureID, outcomeID].map((value) => value.trim()).join("\u0000");
}

function fallbackQuoteKey(
  bookmakerID: string,
  lobbyID: string,
  fixtureID: string,
  marketID: string,
  outcomeName: string
) {
  return [bookmakerID, lobbyID, fixtureID, marketID, outcomeName]
    .map((value) => value.trim().toLowerCase())
    .join("\u0000");
}

function displayMatchName(quote: BackendOdds) {
  if (quote.home_team.trim() && quote.away_team.trim()) {
    return `${quote.home_team.trim()} vs ${quote.away_team.trim()}`;
  }
  return quote.match_name || quote.fixture_id;
}

function isStandardBoardQuote(quote: BackendOdds) {
  if (!inferMarketType(quote.market_type, quote.market_id)) {
    return false;
  }

  const fixtureText = [
    quote.home_team,
    quote.away_team,
    quote.league_name,
    quote.match_name
  ].join(" ");
  return !/(?:corner|e-?soccer|specific\s*\d*\s*min|single[ -]?team|booking|cards?)/i.test(
    fixtureText
  );
}

function buildFixtureIdentityIndex(items: BackendOdds[]) {
  const entries = new Map<string, FixtureIdentityIndexEntry>();
  for (const item of items) {
    const identity = createFixtureIdentity({
      homeTeam: item.home_team,
      awayTeam: item.away_team
    });
    if (!identity) {
      continue;
    }
    const id = sourceFixtureIdentityID(item, identity.key);
    entries.set(id, {
      id,
      sourceId: sourceIDForQuote(item),
      identity
    });
  }
  return indexFixtureIdentities(Array.from(entries.values()));
}

function sourceFixtureIdentityID(quote: BackendOdds, fallbackFixtureID = "") {
  const fixtureID =
    quote.fixture_id ||
    fallbackFixtureID ||
    createFixtureIdentity({
      homeTeam: quote.home_team,
      awayTeam: quote.away_team
    })?.key ||
    "";
  return `${sourceIDForQuote(quote)}\u0000${fixtureID}`;
}

function sourceIDForQuote(quote: BackendOdds) {
  return `${quote.bookmaker_id}/${quote.lobby_id || "default"}`;
}

function currentQuoteKey(quote: BackendOdds) {
  return quoteKey(
    quote.bookmaker_id,
    quote.lobby_id,
    quote.fixture_id,
    quote.outcome_id
  );
}

function isCurrentOpportunity(opportunity: BackendOpportunity, now: number) {
  const detectedAt = new Date(opportunity.detected_at).getTime();
  const expiresAt = new Date(opportunity.expires_at).getTime();
  return (
    Number.isFinite(detectedAt) &&
    Number.isFinite(expiresAt) &&
    now - detectedAt <= CURRENT_OPPORTUNITY_AGE_MS &&
    now <= expiresAt
  );
}

function pickMatchStateValues(current: string, next: string) {
  const order = ["live", "upcoming", "unknown", "finished"];
  const normalizedCurrent = current || "unknown";
  const normalizedNext = next || "unknown";
  const currentIndex = order.indexOf(normalizedCurrent);
  const nextIndex = order.indexOf(normalizedNext);
  if (currentIndex < 0) {
    return normalizedNext;
  }
  if (nextIndex < 0) {
    return normalizedCurrent;
  }
  return nextIndex < currentIndex ? normalizedNext : normalizedCurrent;
}

function latestTimestamp(current: string, next: string) {
  if (!current) {
    return next;
  }
  if (!next) {
    return current;
  }
  return new Date(next).getTime() > new Date(current).getTime() ? next : current;
}
