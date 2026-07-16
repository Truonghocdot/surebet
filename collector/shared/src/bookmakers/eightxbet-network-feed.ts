import type { Page, Response, WebSocket as PlaywrightWebSocket } from "playwright";
import type { OddsSelection, OddsSnapshot } from "../contracts.js";
import { envBool } from "../core/env.js";

type SupportedMarketCode = "ah" | "ah_1st" | "ou" | "ou_1st";

export type EightXBetFixtureMetadata = {
  fixtureId: string;
  homeTeam: string;
  awayTeam: string;
  leagueName: string;
  eventStartAt?: string;
};

type FeedFixtureState = {
  metadata?: EightXBetFixtureMetadata;
  markets: Map<SupportedMarketCode, unknown>;
  seenMarkets: Set<SupportedMarketCode>;
  occurredAt: string;
};

type FeedSnapshotListener = (snapshot: OddsSnapshot, fixtureId: string) => Promise<void>;

const supportedMarketCodes = new Set<SupportedMarketCode>(["ah", "ah_1st", "ou", "ou_1st"]);
export class EightXBetNetworkFeed {
  private readonly fixtures = new Map<string, FeedFixtureState>();
  private listener: FeedSnapshotListener | null = null;
  private deliveryQueue = Promise.resolve();

  constructor(private readonly collectorId: string) {}

  attach(page: Page) {
    const onResponse = (response: Response) => {
      void this.ingestResponse(response);
    };
    const onWebSocket = (socket: PlaywrightWebSocket) => {
      if (!isSportsWebSocket(socket.url())) {
        return;
      }
      socket.on("framereceived", (event) => {
        if (typeof event.payload !== "string") {
          return;
        }
        this.ingestStompFrame(event.payload);
      });
    };

    page.on("response", onResponse);
    page.on("websocket", onWebSocket);
    return () => {
      page.off("response", onResponse);
      page.off("websocket", onWebSocket);
    };
  }

  activate(bootstrap: OddsSnapshot, listener: FeedSnapshotListener) {
    this.seedMetadata(bootstrap);
    this.listener = listener;
    for (const fixtureId of this.fixtures.keys()) {
      this.emitFixture(fixtureId);
    }
  }

  deactivate() {
    this.listener = null;
  }

  overlaySnapshot(domSnapshot: OddsSnapshot) {
    this.seedMetadata(domSnapshot);
    const domByFixture = groupSelectionsByFixture(domSnapshot.selections);
    const fixtureIds = new Set([...domByFixture.keys(), ...this.fixtures.keys()]);
    const selections: OddsSelection[] = [];

    for (const fixtureId of fixtureIds) {
      const state = this.fixtures.get(fixtureId);
      if (!state || state.seenMarkets.size === 0 || !state.metadata) {
        selections.push(...(domByFixture.get(fixtureId) ?? []));
        continue;
      }
      selections.push(...buildSelections(state));
    }

    return {
      ...domSnapshot,
      collectedAt: latestOccurredAt(this.fixtures, domSnapshot.collectedAt),
      selections
    };
  }

  hasDecodedFixture(fixtureId: string) {
    return (this.fixtures.get(fixtureId)?.seenMarkets.size ?? 0) > 0;
  }

  retainFixtures(fixtureIds: string[]) {
    const active = new Set(fixtureIds);
    for (const fixtureId of this.fixtures.keys()) {
      if (!active.has(fixtureId)) {
        this.fixtures.delete(fixtureId);
      }
    }
  }

  async flush() {
    await this.deliveryQueue;
  }

  private async ingestResponse(response: Response) {
    const url = response.url();
    if (!isSportsMetadataResponse(url) && !isSportsMatchResponse(url)) {
      return;
    }

    const payload = await response.json().catch(() => null);
    if (!payload || typeof payload !== "object") {
      return;
    }

    if (isSportsMetadataResponse(url)) {
      for (const match of extractTournamentMatches(payload)) {
        this.applyMetadata(match);
      }
      return;
    }

    const match = extractMatchResponse(payload);
    if (!match) {
      return;
    }
    const fixtureId = stringID(match.iid);
    if (!fixtureId) {
      return;
    }
    this.applyMetadata(match);
    this.applyMarkets(
      fixtureId,
      objectValue(match.market),
      [],
      true,
      timestampOf(match.time ?? match.timestamp)
    );
  }

  private ingestStompFrame(frame: string) {
    const parsed = parseEightXBetOddsDiffFrame(frame);
    if (!parsed) {
      return;
    }

    this.applyMarkets(
      parsed.fixtureId,
      parsed.markets,
      parsed.removedMarkets,
      parsed.full,
      parsed.occurredAt
    );
  }

  private seedMetadata(snapshot: OddsSnapshot) {
    for (const [fixtureId, selections] of groupSelectionsByFixture(snapshot.selections)) {
      const first = selections[0];
      if (!first) {
        continue;
      }
      const current = this.ensureState(fixtureId);
      current.metadata = {
        fixtureId,
        homeTeam: first.homeTeam ?? "",
        awayTeam: first.awayTeam ?? "",
        leagueName: first.leagueName ?? "",
        eventStartAt: first.eventStartAt
      };
    }
  }

  private applyMetadata(value: Record<string, unknown>) {
    const fixtureId = stringID(value.iid);
    if (!fixtureId) {
      return;
    }
    const home = objectValue(value.home);
    const away = objectValue(value.away);
    const current = this.ensureState(fixtureId);
    current.metadata = {
      fixtureId,
      homeTeam: String(home.name ?? current.metadata?.homeTeam ?? "").trim(),
      awayTeam: String(away.name ?? current.metadata?.awayTeam ?? "").trim(),
      leagueName: String(value.tnName ?? current.metadata?.leagueName ?? "").trim(),
      eventStartAt: timestampOf(value.kickoffTime ?? value.kickoff) || current.metadata?.eventStartAt
    };
    if (current.seenMarkets.size > 0) {
      this.emitFixture(fixtureId);
    }
  }

  private applyMarkets(
    fixtureId: string,
    markets: Record<string, unknown>,
    removedMarkets: string[],
    full: boolean,
    occurredAt: string
  ) {
    const current = this.ensureState(fixtureId);
    const touchedMarkets = new Set<SupportedMarketCode>();
    if (full) {
      for (const code of supportedMarketCodes) {
        current.seenMarkets.add(code);
        current.markets.delete(code);
        touchedMarkets.add(code);
      }
    }

    for (const [rawCode, value] of Object.entries(markets)) {
      const code = normalizeMarketCode(rawCode);
      if (!code) {
        continue;
      }
      current.seenMarkets.add(code);
      current.markets.set(code, value);
      touchedMarkets.add(code);
    }
    for (const rawCode of removedMarkets) {
      const code = normalizeMarketCode(rawCode);
      if (!code) {
        continue;
      }
      current.seenMarkets.add(code);
      current.markets.delete(code);
      touchedMarkets.add(code);
    }
    if (touchedMarkets.size === 0) {
      return;
    }

    current.occurredAt = occurredAt || new Date().toISOString();
    if (envBool("EIGHTXBET_STREAM_TELEMETRY", true)) {
      const sourceLagMs = Math.max(Date.now() - new Date(current.occurredAt).getTime(), 0);
      console.log(
        `[8xbet-network] event fixture=${fixtureId} mode=${full ? "init" : "update"}` +
          ` markets=${Array.from(touchedMarkets).join(",")}` +
          ` outcomes=${buildSelections(current).length} source_lag_ms=${sourceLagMs}`
      );
    }
    this.emitFixture(fixtureId);
  }

  private emitFixture(fixtureId: string) {
    if (!this.listener) {
      return;
    }
    const state = this.fixtures.get(fixtureId);
    if (!state?.metadata || state.seenMarkets.size === 0) {
      return;
    }
    const snapshot: OddsSnapshot = {
      source: {
        collectorId: this.collectorId,
        bookmakerId: "8xbet",
        lobbyId: "default"
      },
      collectedAt: state.occurredAt || new Date().toISOString(),
      selections: buildSelections(state)
    };
    const listener = this.listener;
    this.deliveryQueue = this.deliveryQueue
      .then(() => listener(snapshot, fixtureId))
      .catch((error) => {
        console.warn(`[8xbet-network] fixture delivery failed fixture=${fixtureId}:`, error);
      });
  }

  private ensureState(fixtureId: string) {
    let state = this.fixtures.get(fixtureId);
    if (!state) {
      state = {
        markets: new Map(),
        seenMarkets: new Set(),
        occurredAt: new Date().toISOString()
      };
      this.fixtures.set(fixtureId, state);
    }
    return state;
  }
}

function buildSelections(state: FeedFixtureState) {
  if (!state.metadata) {
    return [];
  }
  const result: OddsSelection[] = [];
  for (const code of supportedMarketCodes) {
    const market = state.markets.get(code);
    if (!Array.isArray(market)) {
      continue;
    }
    if (code === "ah" || code === "ah_1st") {
      result.push(...buildHandicapSelections(state.metadata, code, market));
    } else {
      result.push(...buildOverUnderSelections(state.metadata, code, market));
    }
  }
  return result;
}

function buildHandicapSelections(
  metadata: EightXBetFixtureMetadata,
  code: "ah" | "ah_1st",
  lines: unknown[]
) {
  const marketId = code === "ah" ? "hdp-ah" : "hdp-ah-1st";
  const result: OddsSelection[] = [];
  for (const rawLine of lines) {
    const line = objectValue(rawLine);
    const lineValue = normalizeAsianLine(String(line.k ?? ""));
    const homeOdds = normalizeFeedOdds(line.h);
    const awayOdds = normalizeFeedOdds(line.a);
    if (!lineValue || homeOdds === null || awayOdds === null) {
      continue;
    }
    const homeOutcome = `${metadata.homeTeam} ${lineValue}`.trim();
    const awayOutcome = `${metadata.awayTeam} ${invertAsianLine(lineValue)}`.trim();
    result.push(
      selectionOf(metadata, marketId, homeOutcome, homeOdds),
      selectionOf(metadata, marketId, awayOutcome, awayOdds)
    );
  }
  return result;
}

function buildOverUnderSelections(
  metadata: EightXBetFixtureMetadata,
  code: "ou" | "ou_1st",
  lines: unknown[]
) {
  const marketId = code === "ou" ? "o-u-ou" : "o-u-ou-1st";
  const result: OddsSelection[] = [];
  for (const rawLine of lines) {
    const line = objectValue(rawLine);
    const lineValue = String(line.k ?? "").trim();
    const overOdds = normalizeFeedOdds(line.ov);
    const underOdds = normalizeFeedOdds(line.ud);
    if (!lineValue || overOdds === null || underOdds === null) {
      continue;
    }
    result.push(
      selectionOf(metadata, marketId, `Over ${lineValue}`, overOdds),
      selectionOf(metadata, marketId, `Under ${lineValue}`, underOdds)
    );
  }
  return result;
}

function selectionOf(
  metadata: EightXBetFixtureMetadata,
  marketId: string,
  outcomeName: string,
  odds: number
): OddsSelection {
  return {
    fixtureId: metadata.fixtureId,
    sport: "football",
    homeTeam: metadata.homeTeam,
    awayTeam: metadata.awayTeam,
    leagueName: metadata.leagueName,
    matchState: "live",
    eventStartAt: metadata.eventStartAt,
    marketId,
    outcomeId: `${metadata.fixtureId}:${marketId}:${normalizeToken(outcomeName)}`,
    outcomeName,
    odds,
    availableStake: 0,
    suspended: false
  };
}

function normalizeFeedOdds(value: unknown) {
  const parsed = Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  const malay = parsed > 1 ? -1 / parsed : parsed;
  return Math.round(malay * 100) / 100;
}

function normalizeAsianLine(value: string) {
  const line = value.replace(/\s+/g, "").trim();
  if (!line) {
    return "";
  }
  if (line.startsWith("+") || line.startsWith("-")) {
    return line;
  }
  return `+${line}`;
}

function invertAsianLine(value: string) {
  if (value.startsWith("+")) {
    return `-${value.slice(1)}`;
  }
  if (value.startsWith("-")) {
    return `+${value.slice(1)}`;
  }
  return value;
}

function normalizeToken(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function normalizeMarketCode(value: string): SupportedMarketCode | null {
  const code = value.trim().toLowerCase() as SupportedMarketCode;
  return supportedMarketCodes.has(code) ? code : null;
}

export function parseEightXBetOddsDiffFrame(frame: string) {
  if (!frame.startsWith("MESSAGE")) {
    return null;
  }
  const separator = /\r?\n\r?\n/.exec(frame);
  if (!separator || separator.index < 0) {
    return null;
  }
  const headers = frame.slice(0, separator.index).split(/\r?\n/);
  const destination = headers
    .find((line) => line.startsWith("destination:"))
    ?.slice("destination:".length)
    .trim();
  if (!destination) {
    return null;
  }
  try {
    const body = JSON.parse(
      frame.slice(separator.index + separator[0].length).replace(/\u0000+$/g, "")
    );
    if (!body || typeof body !== "object") {
      return null;
    }
    const objectBody = body as Record<string, unknown>;
    if (!destination.includes("/topic/odds-diff/match/")) {
      return null;
    }
    const fixtureId = stringID(objectBody.iid) || fixtureIDFromDestination(destination);
    if (!fixtureId) {
      return null;
    }
    return {
      fixtureId,
      markets: objectValue(objectBody.market),
      removedMarkets: stringArray(objectBody.removeMarket),
      full: String(objectBody.sendType ?? "").toUpperCase() === "INIT",
      occurredAt: timestampOf(objectBody.nwTimestamp ?? objectBody._msgId)
    };
  } catch {
    return null;
  }
}

export function buildEightXBetNetworkFixtureSnapshot(options: {
  collectorId?: string;
  metadata: EightXBetFixtureMetadata;
  markets: Partial<Record<SupportedMarketCode, unknown>>;
  occurredAt: string;
}) {
  const state: FeedFixtureState = {
    metadata: options.metadata,
    markets: new Map(),
    seenMarkets: new Set(),
    occurredAt: options.occurredAt
  };
  for (const [rawCode, market] of Object.entries(options.markets)) {
    const code = normalizeMarketCode(rawCode);
    if (!code) continue;
    state.seenMarkets.add(code);
    state.markets.set(code, market);
  }
  return {
    source: {
      collectorId: options.collectorId ?? "8xbet",
      bookmakerId: "8xbet" as const,
      lobbyId: "default" as const
    },
    collectedAt: options.occurredAt,
    selections: buildSelections(state)
  } satisfies OddsSnapshot;
}

function extractTournamentMatches(payload: Record<string, unknown>) {
  const data = objectValue(payload.data);
  const tournaments = Array.isArray(data.tournaments) ? data.tournaments : [];
  return tournaments.flatMap((rawTournament) => {
    const tournament = objectValue(rawTournament);
    const matches = Array.isArray(tournament.matches) ? tournament.matches : [];
    return matches.map((rawMatch) => ({
      ...objectValue(rawMatch),
      tnName: objectValue(rawMatch).tnName ?? tournament.name ?? ""
    }));
  });
}

function extractMatchResponse(payload: Record<string, unknown>) {
  const first = objectValue(payload.data);
  const match = objectValue(first.data);
  return stringID(match.iid) ? match : null;
}

function groupSelectionsByFixture(selections: OddsSelection[]) {
  const grouped = new Map<string, OddsSelection[]>();
  for (const selection of selections) {
    const current = grouped.get(selection.fixtureId) ?? [];
    current.push(selection);
    grouped.set(selection.fixtureId, current);
  }
  return grouped;
}

function latestOccurredAt(fixtures: Map<string, FeedFixtureState>, fallback: string) {
  let latest = new Date(fallback).getTime();
  for (const state of fixtures.values()) {
    latest = Math.max(latest, new Date(state.occurredAt).getTime());
  }
  return Number.isFinite(latest) ? new Date(latest).toISOString() : fallback;
}

function timestampOf(value: unknown) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    const milliseconds = numeric < 10_000_000_000 ? numeric * 1_000 : numeric;
    return new Date(milliseconds).toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  return new Date().toISOString();
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String) : [];
}

function stringID(value: unknown) {
  const result = String(value ?? "").trim();
  return /^\d+$/.test(result) ? result : "";
}

function fixtureIDFromDestination(destination: string) {
  return destination.match(/\/topic\/odds-diff\/match\/(\d+)/)?.[1] ?? "";
}

function isSportsWebSocket(url: string) {
  return url.includes("/websocket/ws") && /gw-nwwss/i.test(url);
}

function isSportsMetadataResponse(url: string) {
  return url.includes("/product/business/sport/tournament/info") && url.includes("inplay=true");
}

function isSportsMatchResponse(url: string) {
  return url.includes("/product/business/sport/inplay/match");
}
