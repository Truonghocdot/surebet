import { NextResponse } from "next/server";
import { getSessionUser } from "@/features/auth/server/session";
import { filterOpportunitiesForRole } from "@/lib/opportunity-visibility";
import {
  fetchBackendOdds,
  fetchBackendOpportunities,
  type BackendOdds
} from "@/lib/server-dashboard-data";
import { canonicalFixtureKey } from "@/lib/fixture-identity";

type MarketType = "handicap" | "over_under";

type MutableMarket = {
  id: string;
  period: string;
  line: string;
  outcomes: Array<{
    outcome_id: string;
    outcome_name: string;
    side: string;
    odds: number;
    collected_at: string;
    is_surebet_leg: boolean;
  }>;
};

type MutableSource = {
  id: string;
  bookmaker_id: string;
  lobby_id: string;
  latest_collected_at: string;
  markets: Record<MarketType, Map<string, MutableMarket>>;
};

type MutableFixture = {
  id: string;
  match_name: string;
  match_state: string;
  latest_collected_at: string;
  leagues: Set<string>;
  sources: Map<string, MutableSource>;
  has_surebet: boolean;
};

export async function GET() {
  try {
    const [user, odds, rawOpportunities] = await Promise.all([
      getSessionUser(),
      fetchBackendOdds(false),
      fetchBackendOpportunities()
    ]);
    const opportunities = filterOpportunitiesForRole(rawOpportunities, user?.role);
    const surebetLegs = new Set(
      opportunities.flatMap((opportunity) =>
        opportunity.legs.map((leg) => outcomeKey(leg.bookmaker_id, leg.lobby_id, leg.outcome_id))
      )
    );

    const fixtures = groupOpportunityBoard(odds, surebetLegs)
      .filter((fixture) => fixture.sources.size >= 2)
      .map(serializeFixture)
      .sort((left, right) => {
        if (left.has_surebet !== right.has_surebet) {
          return left.has_surebet ? -1 : 1;
        }
        return (
          new Date(right.latest_collected_at).getTime() -
          new Date(left.latest_collected_at).getTime()
        );
      });

    return NextResponse.json({ items: fixtures });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Không tải được bảng so sánh kèo."
      },
      { status: 502 }
    );
  }
}

function groupOpportunityBoard(items: BackendOdds[], surebetLegs: Set<string>) {
  const fixtures = new Map<string, MutableFixture>();

  for (const item of items) {
    const observedAt = item.last_observed_at || item.collected_at;
    const changedAt = item.changed_at || item.collected_at;
    const fixtureID = canonicalFixtureKey({
      homeTeam: item.home_team,
      awayTeam: item.away_team
    });
    if (!fixtureID) {
      continue;
    }

    const sourceID = sourceKey(item.bookmaker_id, item.lobby_id);
    const marketID = [
      item.period || "FT",
      item.market_type || "unknown",
      item.market_id || "unknown",
      item.line || ""
    ].join("\u0000");
    const existingFixture = fixtures.get(fixtureID);
    const fixture = existingFixture ?? {
      id: fixtureID,
      match_name: displayMatchName(item),
      match_state: normalizeMatchState(item.match_state),
      latest_collected_at: observedAt,
      leagues: new Set<string>(),
      sources: new Map<string, MutableSource>(),
      has_surebet: false
    };

    fixture.match_state = pickMatchState(fixture.match_state, item.match_state);
    fixture.latest_collected_at = latestTimestamp(fixture.latest_collected_at, observedAt);
    if (item.league_name.trim()) {
      fixture.leagues.add(item.league_name.trim());
    }

    const existingSource = fixture.sources.get(sourceID);
    const source = existingSource ?? {
      id: sourceID,
      bookmaker_id: item.bookmaker_id,
      lobby_id: item.lobby_id,
      latest_collected_at: observedAt,
      markets: {
        handicap: new Map<string, MutableMarket>(),
        over_under: new Map<string, MutableMarket>()
      }
    };
    source.latest_collected_at = latestTimestamp(source.latest_collected_at, observedAt);

    // Keep the fixture visible when a live source temporarily exposes only 1X2 or another unsupported market.
    fixture.sources.set(sourceID, source);
    fixtures.set(fixtureID, fixture);

    const marketType = supportedMarketType(item.market_type);
    if (!marketType) {
      continue;
    }

    const existingMarket = source.markets[marketType].get(marketID);
    const market = existingMarket ?? {
      id: marketID,
      period: item.period || "FT",
      line: item.line || "",
      outcomes: []
    };
    const isSurebetLeg = surebetLegs.has(
      outcomeKey(item.bookmaker_id, item.lobby_id, item.outcome_id)
    );
    market.outcomes.push({
      outcome_id: item.outcome_id,
      outcome_name: item.outcome_name,
      side: item.side,
      odds: item.odds,
      collected_at: changedAt,
      is_surebet_leg: isSurebetLeg
    });
    source.markets[marketType].set(marketID, market);
    fixture.has_surebet ||= isSurebetLeg;
  }

  return Array.from(fixtures.values());
}

function serializeFixture(fixture: MutableFixture) {
  return {
    id: fixture.id,
    match_name: fixture.match_name,
    match_state: fixture.match_state,
    latest_collected_at: fixture.latest_collected_at,
    league_names: Array.from(fixture.leagues).sort((left, right) => left.localeCompare(right)),
    has_surebet: fixture.has_surebet,
    sources: Array.from(fixture.sources.values())
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

function serializeMarkets(markets: Map<string, MutableMarket>) {
  return Array.from(markets.values())
    .map((market) => ({
      ...market,
      outcomes: market.outcomes.sort(compareOutcomes)
    }))
    .sort(compareMarkets);
}

function supportedMarketType(value: string): MarketType | null {
  if (value === "handicap" || value === "over_under") {
    return value;
  }
  return null;
}

function sourceKey(bookmakerID: string, lobbyID: string) {
  return `${bookmakerID}\u0000${lobbyID}`;
}

function outcomeKey(bookmakerID: string, lobbyID: string, outcomeID: string) {
  return `${bookmakerID.trim()}\u0000${lobbyID.trim()}\u0000${outcomeID}`;
}

function displayMatchName(item: BackendOdds) {
  if (item.home_team.trim() && item.away_team.trim()) {
    return `${item.home_team.trim()} vs ${item.away_team.trim()}`;
  }
  return item.match_name || item.fixture_id || "Chưa rõ trận đấu";
}

function normalizeMatchState(value: string) {
  return value || "unknown";
}

function pickMatchState(current: string, next: string) {
  const order = ["live", "upcoming", "unknown", "finished"];
  const currentIndex = order.indexOf(normalizeMatchState(current));
  const nextState = normalizeMatchState(next);
  const nextIndex = order.indexOf(nextState);
  if (currentIndex === -1 || nextIndex < currentIndex) {
    return nextState;
  }
  return current;
}

function latestTimestamp(current: string, next: string) {
  if (!current || new Date(next).getTime() > new Date(current).getTime()) {
    return next;
  }
  return current;
}

function compareMarkets(left: MutableMarket, right: MutableMarket) {
  const periodOrder = periodRank(left.period) - periodRank(right.period);
  if (periodOrder !== 0) {
    return periodOrder;
  }
  const lineOrder = lineRank(left.line) - lineRank(right.line);
  if (lineOrder !== 0) {
    return lineOrder;
  }
  return left.line.localeCompare(right.line);
}

function compareOutcomes(
  left: MutableMarket["outcomes"][number],
  right: MutableMarket["outcomes"][number]
) {
  const sideOrder = sideRank(left.side) - sideRank(right.side);
  if (sideOrder !== 0) {
    return sideOrder;
  }
  return left.outcome_name.localeCompare(right.outcome_name);
}

function periodRank(period: string) {
  if (period === "FT") {
    return 0;
  }
  if (period === "1H") {
    return 1;
  }
  return 2;
}

function lineRank(line: string) {
  const firstLine = line.split("/")[0] ?? "";
  const parsed = Number.parseFloat(firstLine.replace(/^[+-]/, ""));
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function sideRank(side: string) {
  switch (side) {
    case "home":
    case "over":
      return 0;
    case "away":
    case "under":
      return 1;
    default:
      return 2;
  }
}
