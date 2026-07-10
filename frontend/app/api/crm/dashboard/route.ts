import { NextResponse } from "next/server";
import {
  fetchBackendOdds,
  fetchBackendOpportunities,
  type BackendOdds
} from "@/lib/server-dashboard-data";

export async function GET() {
  try {
    const [opportunities, odds] = await Promise.all([
      fetchBackendOpportunities(),
      fetchBackendOdds(true)
    ]);

    const feedSummaries = summarizeFeeds(odds);
    const liveOdds = odds.filter((item) => !item.suspended && item.odds !== 0);
    const uniqueFixtures = new Set(liveOdds.map((item) => item.fixture_id)).size;
    const avgProfit =
      opportunities.length > 0
        ? opportunities.reduce((sum, item) => sum + item.profit_percentage, 0) /
          opportunities.length
        : 0;

    return NextResponse.json({
      stats: [
        {
          title: "Surebet hiện có",
          value: String(opportunities.length),
          delta:
            opportunities.length > 0
              ? `TB ${avgProfit.toFixed(2)}%`
              : "Chưa phát hiện cơ hội",
          tone: opportunities.length > 0 ? "positive" : "neutral"
        },
        {
          title: "Odds đang sống",
          value: String(liveOdds.length),
          delta: `${odds.length} bản ghi scrape`,
          tone: liveOdds.length > 0 ? "positive" : "warning"
        },
        {
          title: "Fixtures theo dõi",
          value: String(uniqueFixtures),
          delta: `${feedSummaries.length} nguồn feed`,
          tone: uniqueFixtures > 0 ? "neutral" : "warning"
        },
        {
          title: "Nguồn feed hoạt động",
          value: String(feedSummaries.filter((item) => item.status === "LIVE").length),
          delta: `${feedSummaries.length} nguồn đang scrape`,
          tone:
            feedSummaries.some((item) => item.status === "LIVE") ? "positive" : "warning"
        }
      ],
      opportunities,
      feeds: feedSummaries,
      odds: odds
        .sort(
          (left, right) =>
            new Date(right.collected_at).getTime() - new Date(left.collected_at).getTime()
        )
        .slice(0, 18)
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Không tải được dữ liệu dashboard."
      },
      { status: 502 }
    );
  }
}

function summarizeFeeds(odds: BackendOdds[]) {
  const grouped = new Map<
    string,
    {
      source_id: string;
      bookmaker_id: string;
      lobby_id: string;
      live_odds: number;
      fixtures: Set<string>;
      latest_seen_at: string | null;
    }
  >();

  for (const item of odds) {
    const sourceID = `${item.bookmaker_id}/${item.lobby_id}`;
    const current = grouped.get(sourceID) ?? {
      source_id: sourceID,
      bookmaker_id: item.bookmaker_id,
      lobby_id: item.lobby_id,
      live_odds: 0,
      fixtures: new Set<string>(),
      latest_seen_at: null
    };

    if (!item.suspended && item.odds !== 0) {
      current.live_odds += 1;
    }

    current.fixtures.add(item.fixture_id);
    current.latest_seen_at = latestTimestamp(current.latest_seen_at, item.collected_at);
    grouped.set(sourceID, current);
  }

  return Array.from(grouped.values())
    .map((item) => ({
      source_id: item.source_id,
      bookmaker_id: item.bookmaker_id,
      lobby_id: item.lobby_id,
      status: feedStatus(item.latest_seen_at, item.live_odds),
      live_odds: item.live_odds,
      fixtures: item.fixtures.size,
      latest_seen_at: item.latest_seen_at
    }))
    .sort((left, right) => left.source_id.localeCompare(right.source_id));
}

function latestTimestamp(current: string | null, candidate: string) {
  if (!current) {
    return candidate;
  }

  return new Date(candidate).getTime() > new Date(current).getTime() ? candidate : current;
}

function feedStatus(latestSeenAt: string | null, liveOdds: number) {
  if (!latestSeenAt) {
    return "IDLE";
  }

  const ageSeconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(latestSeenAt).getTime()) / 1000)
  );

  if (liveOdds > 0 && ageSeconds <= 60) {
    return "LIVE";
  }

  if (ageSeconds <= 60) {
    return "STALE";
  }

  return "OFFLINE";
}
