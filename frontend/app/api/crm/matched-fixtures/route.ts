import { NextResponse } from "next/server";
import {
  fetchBackendOdds,
  type BackendOdds
} from "@/lib/server-dashboard-data";
import {
  createFixtureIdentity,
  indexFixtureIdentities,
  type FixtureIdentityIndexEntry
} from "@/lib/fixture-identity";

type MutableSource = {
  source_id: string;
  bookmaker_id: string;
  lobby_id: string;
  home_team: string;
  away_team: string;
  match_state: string;
  quote_count: number;
  latest_collected_at: string;
  markets: Set<string>;
};

type MutableFixture = {
  id: string;
  fixture_marker: string;
  match_name: string;
  match_state: string;
  quote_count: number;
  latest_collected_at: string;
  leagues: Set<string>;
  markets: Set<string>;
  sources: Map<string, MutableSource>;
};

export async function GET() {
  try {
    const odds = await fetchBackendOdds(false);
    const grouped = groupMatchedFixtures(odds);
    const items = grouped
      .filter((item) => item.sources.size >= 2)
      .map((item) => ({
        id: item.id,
        fixture_marker: item.fixture_marker,
        match_name: item.match_name,
        league_names: Array.from(item.leagues).sort(),
        match_state: item.match_state,
        source_count: item.sources.size,
        quote_count: item.quote_count,
        market_count: item.markets.size,
        latest_collected_at: item.latest_collected_at,
        sources: Array.from(item.sources.values())
          .map((source) => ({
            source_id: source.source_id,
            bookmaker_id: source.bookmaker_id,
            lobby_id: source.lobby_id,
            home_team: source.home_team,
            away_team: source.away_team,
            match_state: source.match_state,
            quote_count: source.quote_count,
            market_count: source.markets.size,
            latest_collected_at: source.latest_collected_at
          }))
          .sort((left, right) => left.source_id.localeCompare(right.source_id))
      }))
      .sort((left, right) => {
        if (right.source_count !== left.source_count) {
          return right.source_count - left.source_count;
        }
        return (
          new Date(right.latest_collected_at).getTime() -
          new Date(left.latest_collected_at).getTime()
        );
      });

    const activeSources = new Set(
      items.flatMap((item) => item.sources.map((source) => source.source_id))
    ).size;
    const latestCollectedAt = items
      .map((item) => item.latest_collected_at)
      .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] ?? null;

    return NextResponse.json({
      summary: {
        matched_fixtures: items.length,
        active_sources: activeSources,
        total_quotes: items.reduce((sum, item) => sum + item.quote_count, 0),
        latest_collected_at: latestCollectedAt
      },
      items
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Không tải được danh sách trận khớp."
      },
      { status: 502 }
    );
  }
}

function groupMatchedFixtures(items: BackendOdds[]) {
  const grouped = new Map<string, MutableFixture>();
  const fixtureIndex = buildFixtureIdentityIndex(items);

  for (const item of items) {
    const sourceID = `${item.bookmaker_id}/${item.lobby_id || "chung"}`;
    const sourceFixtureID = sourceFixtureIdentityID(item, sourceID);
    const marker = fixtureIndex.get(sourceFixtureID);
    if (!marker) {
      continue;
    }
    const marketID = marketMarker(item);
    const current = grouped.get(marker);
    const fixture = current ?? {
      id: marker,
      fixture_marker: marker,
      match_name: displayMatchName(item),
      match_state: normalizeMatchState(item.match_state),
      quote_count: 0,
      latest_collected_at: item.collected_at,
      leagues: new Set<string>(),
      markets: new Set<string>(),
      sources: new Map<string, MutableSource>()
    };

    fixture.quote_count += 1;
    fixture.match_state = pickMatchState(fixture.match_state, item.match_state);
    fixture.latest_collected_at = latestTimestamp(
      fixture.latest_collected_at,
      item.collected_at
    );
    if (item.league_name) {
      fixture.leagues.add(item.league_name);
    }
    fixture.markets.add(marketID);

    const currentSource = fixture.sources.get(sourceID);
    const source = currentSource ?? {
      source_id: sourceID,
      bookmaker_id: item.bookmaker_id,
      lobby_id: item.lobby_id,
      home_team: item.home_team,
      away_team: item.away_team,
      match_state: normalizeMatchState(item.match_state),
      quote_count: 0,
      latest_collected_at: item.collected_at,
      markets: new Set<string>()
    };

    source.quote_count += 1;
    source.match_state = pickMatchState(source.match_state, item.match_state);
    source.latest_collected_at = latestTimestamp(
      source.latest_collected_at,
      item.collected_at
    );
    source.markets.add(marketID);
    fixture.sources.set(sourceID, source);
    grouped.set(marker, fixture);
  }

  return Array.from(grouped.values());
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
    const sourceID = `${item.bookmaker_id}/${item.lobby_id || "chung"}`;
    const id = sourceFixtureIdentityID(item, sourceID, identity.key);
    entries.set(id, { id, sourceId: sourceID, identity });
  }
  return indexFixtureIdentities(Array.from(entries.values()));
}

function sourceFixtureIdentityID(
  item: BackendOdds,
  sourceID: string,
  fallbackFixtureID = ""
) {
  const fixtureID =
    item.fixture_id ||
    fallbackFixtureID ||
    createFixtureIdentity({
      homeTeam: item.home_team,
      awayTeam: item.away_team
    })?.key ||
    "";
  return `${sourceID}\u0000${fixtureID}`;
}

function marketMarker(item: BackendOdds) {
  return [
    item.period || "ft",
    item.market_type || item.market_id || "unknown",
    item.line || "none"
  ].join("|");
}

function displayMatchName(item: BackendOdds) {
  if (item.match_name) {
    return item.match_name;
  }
  if (item.home_team || item.away_team) {
    return `${item.home_team || "Đội nhà"} - ${item.away_team || "Đội khách"}`;
  }
  return item.fixture_id || item.fixture_marker || "Chưa rõ trận đấu";
}

function normalizeMatchState(value: string) {
  return value || "unknown";
}

function pickMatchState(current: string, next: string) {
  const order = ["live", "upcoming", "unknown", "finished"];
  const normalizedNext = normalizeMatchState(next);
  const currentIndex = order.indexOf(current);
  const nextIndex = order.indexOf(normalizedNext);
  if (currentIndex === -1) {
    return normalizedNext;
  }
  if (nextIndex === -1) {
    return current;
  }
  return nextIndex < currentIndex ? normalizedNext : current;
}

function latestTimestamp(current: string, next: string) {
  if (!next) {
    return current;
  }
  if (!current) {
    return next;
  }
  return new Date(next).getTime() > new Date(current).getTime() ? next : current;
}
