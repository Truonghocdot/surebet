import {
  FIXTURE_SIMILARITY_THRESHOLD,
  createFixtureIdentity,
  fixtureIdentitySimilarity,
  type FixtureIdentity
} from "@/lib/fixture-identity";
import type { BackendOdds } from "@/lib/server-dashboard-data";

const FIXTURE_START_TIME_TOLERANCE_MS = 15 * 60 * 1_000;

const monitoredSources = [
  {
    id: "jun88/cmd",
    bookmakerID: "jun88",
    lobbyID: "cmd",
    label: "Jun88 CMD"
  },
  {
    id: "8xbet/default",
    bookmakerID: "8xbet",
    lobbyID: "default",
    label: "8xbet"
  }
] as const;

type MonitoredSourceID = (typeof monitoredSources)[number]["id"];

type FixtureCandidate = {
  key: string;
  identity: FixtureIdentity;
  eventStartAt?: string | null;
};

export type FixtureMatchingMonitor = {
  state: "matching" | "waiting" | "source_missing";
  matched_fixtures: number;
  checked_at: string;
  sources: Array<{
    id: MonitoredSourceID;
    bookmaker_id: string;
    lobby_id: string;
    label: string;
    active_fixtures: number;
    latest_observed_at?: string;
    has_data: boolean;
  }>;
};

export function buildFixtureMatchingMonitor(
  odds: BackendOdds[],
  now = Date.now()
): FixtureMatchingMonitor {
  const fixtureKeysBySource = new Map<MonitoredSourceID, Set<string>>();
  const candidatesBySource = new Map<MonitoredSourceID, Map<string, FixtureCandidate>>();
  const latestObservationBySource = new Map<MonitoredSourceID, number>();

  for (const source of monitoredSources) {
    fixtureKeysBySource.set(source.id, new Set());
    candidatesBySource.set(source.id, new Map());
  }

  for (const quote of odds) {
    const source = resolveMonitoredSource(quote);
    if (!source || !isActiveQuote(quote)) {
      continue;
    }

    const fixtureID = quote.fixture_id.trim();
    if (!fixtureID) {
      continue;
    }

    const fixtureKey = `${source.id}\u0000${fixtureID}`;
    fixtureKeysBySource.get(source.id)?.add(fixtureKey);
    updateLatestObservation(latestObservationBySource, source.id, quote);

    const sourceCandidates = candidatesBySource.get(source.id);
    if (!sourceCandidates || sourceCandidates.has(fixtureKey)) {
      continue;
    }

    const identity = createFixtureIdentity({
      homeTeam: quote.home_team,
      awayTeam: quote.away_team
    });
    if (!identity) {
      continue;
    }

    sourceCandidates.set(fixtureKey, {
      key: fixtureKey,
      identity,
      eventStartAt: quote.event_start_at
    });
  }

  const left = [...(candidatesBySource.get("jun88/cmd")?.values() ?? [])];
  const right = [...(candidatesBySource.get("8xbet/default")?.values() ?? [])];
  const matchedFixtures = countFixtureMatches(left, right);
  const sources = monitoredSources.map((source) => {
    const activeFixtures = fixtureKeysBySource.get(source.id)?.size ?? 0;
    const latestObservedAt = latestObservationBySource.get(source.id);
    return {
      id: source.id,
      bookmaker_id: source.bookmakerID,
      lobby_id: source.lobbyID,
      label: source.label,
      active_fixtures: activeFixtures,
      latest_observed_at: latestObservedAt
        ? new Date(latestObservedAt).toISOString()
        : undefined,
      has_data: activeFixtures > 0
    };
  });
  const allSourcesHaveData = sources.every((source) => source.has_data);

  return {
    state: !allSourcesHaveData
      ? "source_missing"
      : matchedFixtures > 0
        ? "matching"
        : "waiting",
    matched_fixtures: matchedFixtures,
    checked_at: new Date(now).toISOString(),
    sources
  };
}

function countFixtureMatches(left: FixtureCandidate[], right: FixtureCandidate[]) {
  const candidates = left.flatMap((leftFixture, leftIndex) =>
    right.flatMap((rightFixture, rightIndex) => {
      if (startTimesConflict(leftFixture, rightFixture)) {
        return [];
      }

      const score = fixtureIdentitySimilarity(
        leftFixture.identity,
        rightFixture.identity
      );
      return score > FIXTURE_SIMILARITY_THRESHOLD
        ? [{ leftIndex, rightIndex, score }]
        : [];
    })
  );

  candidates.sort((leftCandidate, rightCandidate) => {
    if (leftCandidate.score !== rightCandidate.score) {
      return rightCandidate.score - leftCandidate.score;
    }
    const leftKeyOrder = left[leftCandidate.leftIndex].key.localeCompare(
      left[rightCandidate.leftIndex].key
    );
    return leftKeyOrder !== 0
      ? leftKeyOrder
      : right[leftCandidate.rightIndex].key.localeCompare(
          right[rightCandidate.rightIndex].key
        );
  });

  const matchedLeft = new Set<number>();
  const matchedRight = new Set<number>();
  for (const candidate of candidates) {
    if (
      matchedLeft.has(candidate.leftIndex) ||
      matchedRight.has(candidate.rightIndex)
    ) {
      continue;
    }
    matchedLeft.add(candidate.leftIndex);
    matchedRight.add(candidate.rightIndex);
  }
  return matchedLeft.size;
}

function startTimesConflict(left: FixtureCandidate, right: FixtureCandidate) {
  const leftStart = Date.parse(left.eventStartAt ?? "");
  const rightStart = Date.parse(right.eventStartAt ?? "");
  return Number.isFinite(leftStart) &&
    Number.isFinite(rightStart) &&
    Math.abs(leftStart - rightStart) > FIXTURE_START_TIME_TOLERANCE_MS;
}

function resolveMonitoredSource(quote: BackendOdds) {
  const bookmakerID = quote.bookmaker_id.trim().toLowerCase();
  const lobbyID = quote.lobby_id.trim().toLowerCase();
  return monitoredSources.find(
    (source) => source.bookmakerID === bookmakerID && source.lobbyID === lobbyID
  );
}

function isActiveQuote(quote: BackendOdds) {
  return !quote.suspended &&
    quote.odds !== 0 &&
    quote.match_state.trim().toLowerCase() !== "finished";
}

function updateLatestObservation(
  observations: Map<MonitoredSourceID, number>,
  sourceID: MonitoredSourceID,
  quote: BackendOdds
) {
  const observedAt = [
    quote.last_observed_at,
    quote.market_observed_at,
    quote.collected_at
  ].reduce((latest, value) => {
    const timestamp = Date.parse(value ?? "");
    return Number.isFinite(timestamp) ? Math.max(latest, timestamp) : latest;
  }, 0);
  if (observedAt > (observations.get(sourceID) ?? 0)) {
    observations.set(sourceID, observedAt);
  }
}
