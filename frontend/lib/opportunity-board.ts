import type {
  BackendOdds,
  BackendOpportunity
} from "@/lib/server-dashboard-data";
import {
  classifyOpportunityOddsProfile,
  type OpportunityOddsProfile
} from "@/lib/opportunity-visibility";

type MarketType = "handicap" | "over_under";

type BoardOutcome = {
  outcome_id: string;
  outcome_name: string;
  side: string;
  odds: number;
  collected_at: string;
  is_surebet_leg: boolean;
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
  has_surebet: true;
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
  const exactQuotes = new Map<string, BackendOdds>();
  const fallbackQuotes = new Map<string, BackendOdds>();
  for (const quote of odds) {
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

  return opportunities
    .map((opportunity) =>
      buildOpportunityItem(opportunity, exactQuotes, fallbackQuotes)
    )
    .filter((item): item is CurrentOpportunityBoardItem => item !== null)
    .sort((left, right) => {
      if (right.profit_percentage !== left.profit_percentage) {
        return right.profit_percentage - left.profit_percentage;
      }
      return (
        new Date(right.latest_collected_at).getTime() -
        new Date(left.latest_collected_at).getTime()
      );
    });
}

function buildOpportunityItem(
  opportunity: BackendOpportunity,
  exactQuotes: Map<string, BackendOdds>,
  fallbackQuotes: Map<string, BackendOdds>
): CurrentOpportunityBoardItem | null {
  if (opportunity.legs.length !== 2) {
    return null;
  }

  const sources = new Map<string, MutableSource>();
  const metadata: BackendOdds[] = [];
  let includedLegs = 0;

  for (const leg of opportunity.legs) {
    const quote =
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
      );
    if (quote) {
      metadata.push(quote);
    }

    const marketType = inferMarketType(
      quote?.market_type ?? opportunity.market_name,
      leg.market_id
    );
    if (!marketType) {
      continue;
    }

    const period = quote?.period || inferPeriod(leg.market_id);
    const line = quote?.line || inferLine(leg.outcome_name);
    const sourceID = `${leg.bookmaker_id}/${leg.lobby_id || "default"}`;
    const source = sources.get(sourceID) ?? {
      id: sourceID,
      bookmaker_id: leg.bookmaker_id,
      lobby_id: leg.lobby_id,
      latest_collected_at: opportunity.detected_at,
      markets: {
        handicap: new Map<string, BoardMarket>(),
        over_under: new Map<string, BoardMarket>()
      }
    };
    const marketKey = `${period}\u0000${marketType}\u0000${line}`;
    const market = source.markets[marketType].get(marketKey) ?? {
      id: `${opportunity.id}\u0000${sourceID}\u0000${marketKey}`,
      period,
      line,
      outcomes: []
    };
    market.outcomes.push({
      outcome_id: leg.outcome_id,
      outcome_name: leg.outcome_name,
      side: quote?.side || inferSide(marketType, leg.outcome_name),
      odds: leg.odds,
      collected_at: opportunity.detected_at,
      is_surebet_leg: true
    });
    source.markets[marketType].set(marketKey, market);
    sources.set(sourceID, source);
    includedLegs += 1;
  }

  if (includedLegs !== 2 || sources.size < 2) {
    return null;
  }

  const primaryMetadata = metadata[0];
  return {
    id: opportunity.id,
    match_name: primaryMetadata
      ? displayMatchName(primaryMetadata)
      : opportunity.fixture_id,
    match_state: pickMatchState(metadata),
    market_name: opportunity.market_name,
    profit_percentage: opportunity.profit_percentage,
    expected_return: opportunity.expected_return,
    odds_profile: classifyOpportunityOddsProfile(opportunity),
    latest_collected_at: opportunity.detected_at,
    confirmed_at: opportunity.detected_at,
    expires_at: opportunity.expires_at,
    league_names: Array.from(
      new Set(metadata.map((quote) => quote.league_name.trim()).filter(Boolean))
    ).sort((left, right) => left.localeCompare(right)),
    has_surebet: true,
    sources: Array.from(sources.values())
      .map((source) => ({
        id: source.id,
        bookmaker_id: source.bookmaker_id,
        lobby_id: source.lobby_id,
        latest_collected_at: source.latest_collected_at,
        handicap: serializeMarkets(source.markets.handicap),
        over_under: serializeMarkets(source.markets.over_under)
      }))
      .sort((left, right) => left.id.localeCompare(right.id))
  };
}

function serializeMarkets(markets: Map<string, BoardMarket>) {
  return Array.from(markets.values()).map((market) => ({
    ...market,
    outcomes: [...market.outcomes].sort((left, right) =>
      left.outcome_name.localeCompare(right.outcome_name)
    )
  }));
}

function inferMarketType(value: string, marketID: string): MarketType | null {
  const normalized = `${value} ${marketID}`.toLowerCase();
  if (normalized.includes("hdp") || normalized.includes("handicap")) {
    return "handicap";
  }
  if (
    normalized.includes("over_under") ||
    normalized.includes("o-u-ou") ||
    /(^|[^a-z])ou([^a-z]|$)/.test(normalized)
  ) {
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

function pickMatchState(metadata: BackendOdds[]) {
  const order = ["live", "upcoming", "unknown", "finished"];
  return metadata.reduce((current, quote) => {
    const next = quote.match_state || "unknown";
    return order.indexOf(next) < order.indexOf(current) ? next : current;
  }, "unknown");
}
