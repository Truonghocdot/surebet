import type { Page, Response, WebSocket as PlaywrightWebSocket } from "playwright";
import type { OddsDelta, OddsSelection, OddsSnapshot } from "../contracts.js";
import { envBool, envInt } from "../core/env.js";
import { buildDeltas } from "./streaming-utils.js";

type SupportedMarketCode = "ah" | "ah_1st" | "ou" | "ou_1st";

export type EightXBetFixtureMetadata = {
  fixtureId: string;
  homeTeam: string;
  awayTeam: string;
  leagueName: string;
  eventStartAt?: string;
};

export type EightXBetOddsFormatDiagnostics = {
  destination: string;
  priceDisplay: string;
  rawOddsSamples: number[];
  observationCount: number;
  healthy: boolean;
  unhealthyReason: string;
};

type FeedFixtureState = {
  metadata?: EightXBetFixtureMetadata;
  markets: Map<SupportedMarketCode, unknown>;
  seenMarkets: Set<SupportedMarketCode>;
  selectionsByMarket: Map<SupportedMarketCode, OddsSelection[]>;
  deliveredSelections: Map<string, OddsSelection>;
  pendingMarkets: Set<SupportedMarketCode>;
  occurredAt: string;
  lastEventFull: boolean;
  lastTouchedMarkets: SupportedMarketCode[];
  sourceEventId: string;
  oddsFormat: "indonesian";
  retired: boolean;
};

type FeedDeltaListener = (deltas: OddsDelta[], fixtureId: string) => Promise<void>;
type ActiveFixtureListener = (fixtureIds: string[]) => Promise<void> | void;

const supportedMarketCodes = new Set<SupportedMarketCode>(["ah", "ah_1st", "ou", "ou_1st"]);
export class EightXBetNetworkFeed {
  private readonly fixtures = new Map<string, FeedFixtureState>();
  private readonly pendingFixtureIds = new Set<string>();
  private listener: FeedDeltaListener | null = null;
  private activeFixtureListener: ActiveFixtureListener | null = null;
  private activeMetadataFixtureIds: Set<string> | null = null;
  private lastNotifiedFixtureSignature = "";
  private deliveryQueue = Promise.resolve();
  private deliveryRunning = false;
  private lastTelemetryAt = 0;
  private lastCoverageAt = 0;
  private lastCoverageSignature = "";
  private metadataFixtureTotal = 0;
  private metadataGeneration = 0;
  private latestSportsAPIOrigin = "";
  private latestOddsDestination = "";
  private priceDisplay = "";
  private rawOddsSamples: number[] = [];
  private formatObservationCount = 0;
  private formatUnhealthyReason = "";
  private lastOddsMessageAtMs = 0;
  private readonly deliveryRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly collectorId: string) {}

  attach(page: Page) {
    this.resetOddsFormatObservation(true);
    const metadataGeneration = ++this.metadataGeneration;
    this.activeMetadataFixtureIds = null;
    this.lastNotifiedFixtureSignature = "";
    this.lastCoverageAt = 0;
    this.lastCoverageSignature = "";
    this.metadataFixtureTotal = 0;
    this.lastOddsMessageAtMs = 0;
    const onResponse = (response: Response) => {
      void this.ingestResponse(response, metadataGeneration);
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
      if (this.metadataGeneration === metadataGeneration) {
        this.metadataGeneration += 1;
        this.activeMetadataFixtureIds = null;
      }
    };
  }

  activate(
    bootstrap: OddsSnapshot,
    listener: FeedDeltaListener,
    activeFixtureListener?: ActiveFixtureListener
  ) {
    this.seedMetadata(bootstrap);
    this.listener = listener;
    this.activeFixtureListener = activeFixtureListener ?? null;
    const bootstrapByFixture = groupSelectionsByFixture(bootstrap.selections);
    for (const [fixtureId, state] of this.fixtures) {
      state.deliveredSelections = new Map(
        (bootstrapByFixture.get(fixtureId) ?? []).map((selection) => [
          selection.outcomeId,
          selection
        ])
      );
      for (const code of state.seenMarkets) {
        state.pendingMarkets.add(code);
      }
      this.emitFixture(fixtureId);
    }
    this.notifyActiveFixtures();
  }

  deactivate() {
    this.listener = null;
    this.activeFixtureListener = null;
    this.lastNotifiedFixtureSignature = "";
    this.pendingFixtureIds.clear();
    for (const state of this.fixtures.values()) {
      state.pendingMarkets.clear();
    }
    for (const timer of this.deliveryRetryTimers.values()) {
      clearTimeout(timer);
    }
    this.deliveryRetryTimers.clear();
  }

  overlaySnapshot(domSnapshot: OddsSnapshot) {
    this.seedMetadata(domSnapshot);
    const domByFixture = groupSelectionsByFixture(domSnapshot.selections);
    const fixtureIds = new Set([...domByFixture.keys(), ...this.fixtures.keys()]);
    const selections: OddsSelection[] = [];

    for (const fixtureId of fixtureIds) {
      const state = this.fixtures.get(fixtureId);
      if (state?.retired) {
        continue;
      }
      if (!state || state.seenMarkets.size === 0 || !state.metadata) {
        selections.push(...(domByFixture.get(fixtureId) ?? []));
        continue;
      }
      selections.push(...allSelections(state));
    }

    return {
      ...domSnapshot,
      // A reconciliation re-observes every retained price, even when it has
      // not changed since the source's last market event.
      collectedAt: new Date().toISOString(),
      selections
    };
  }

  hasDecodedFixture(fixtureId: string) {
    return (this.fixtures.get(fixtureId)?.seenMarkets.size ?? 0) > 0;
  }

  pendingActiveFixtureIds() {
    return (this.activeFixtureIds() ?? []).filter(
      (fixtureId) => !this.hasDecodedFixture(fixtureId)
    );
  }

  lastOddsMessageAt() {
    return this.lastOddsMessageAtMs;
  }

  activeFixtureIds() {
    return this.activeMetadataFixtureIds
      ? Array.from(this.activeMetadataFixtureIds).sort()
      : null;
  }

  oddsFormatDiagnostics(): EightXBetOddsFormatDiagnostics {
    return {
      destination: this.latestOddsDestination,
      priceDisplay: this.priceDisplay,
      rawOddsSamples: [...this.rawOddsSamples],
      observationCount: this.formatObservationCount,
      healthy:
        this.formatUnhealthyReason === "" &&
        this.priceDisplay === "pd1" &&
        this.rawOddsSamples.length >= 2,
      unhealthyReason: this.formatUnhealthyReason
    };
  }

  resetOddsFormatObservation(clearQuotes = false) {
    this.priceDisplay = "";
    this.latestOddsDestination = "";
    this.rawOddsSamples = [];
    this.formatObservationCount = 0;
    this.formatUnhealthyReason = "";
    this.lastOddsMessageAtMs = 0;
    if (!clearQuotes) {
      return;
    }
    this.fixtures.clear();
    this.pendingFixtureIds.clear();
    this.activeMetadataFixtureIds = null;
    this.metadataFixtureTotal = 0;
    this.latestSportsAPIOrigin = "";
    for (const timer of this.deliveryRetryTimers.values()) {
      clearTimeout(timer);
    }
    this.deliveryRetryTimers.clear();
  }

  hardConfirmationURL(fixtureId: string) {
    if (!this.latestSportsAPIOrigin || this.priceDisplay !== "pd1" || !/^\d+$/.test(fixtureId)) {
      return "";
    }
    const target = new URL("/product/business/sport/inplay/match", this.latestSportsAPIOrigin);
    target.searchParams.set("sid", "1");
    target.searchParams.set("iid", fixtureId);
    target.searchParams.set("language", "en-us");
    return target.toString();
  }

  async applyFullMatchPayload(payload: unknown) {
    const parsed = parseEightXBetFullMatchPayload(payload);
    if (!parsed) {
      return null;
    }
    this.applyMetadata(parsed.match);
    this.applyMarkets(
      parsed.fixtureId,
      objectValue(parsed.match.market),
      [],
      true,
      parsed.occurredAt,
      parsed.sourceEventId,
      "indonesian"
    );
    await this.flush();
    const state = this.fixtures.get(parsed.fixtureId);
    return state ? this.fixtureSnapshot(parsed.fixtureId, state, allSelections(state)) : null;
  }

  coverageStats() {
    const activeFixtureIds = this.activeMetadataFixtureIds ?? new Set<string>();
    let decodedFixtures = 0;
    let fixturesWithQuotes = 0;
    for (const fixtureId of activeFixtureIds) {
      const state = this.fixtures.get(fixtureId);
      if ((state?.seenMarkets.size ?? 0) > 0) {
        decodedFixtures += 1;
      }
      if (state && selectionCount(state) > 0) {
        fixturesWithQuotes += 1;
      }
    }

    return {
      metadataFixtures: activeFixtureIds.size,
      decodedFixtures,
      fixturesWithQuotes,
      pendingFixtures: Math.max(activeFixtureIds.size - decodedFixtures, 0),
      filteredFixtures: Math.max(this.metadataFixtureTotal - activeFixtureIds.size, 0)
    };
  }

  async flush() {
    await this.deliveryQueue;
  }

  private async ingestResponse(response: Response, metadataGeneration: number) {
    const url = response.url();
    if (!isSportsMetadataResponse(url) && !isSportsMatchResponse(url)) {
      return;
    }
    this.latestSportsAPIOrigin = new URL(url).origin;

    const payload = await response.json().catch(() => null);
    if (
      metadataGeneration !== this.metadataGeneration ||
      !payload ||
      typeof payload !== "object"
    ) {
      return;
    }

    if (isSportsMetadataResponse(url)) {
      if (!isValidTournamentMetadataSnapshot(payload)) {
        return;
      }
      const metadataFixtures = extractTournamentMatches(payload);
      this.applyMetadataSnapshot(
        metadataFixtures.filter(isStandardFootballFixture),
        metadataFixtures.length
      );
      return;
    }

    const parsed = parseEightXBetFullMatchPayload(payload);
    if (!parsed) {
      return;
    }
    this.applyMetadata(parsed.match);
    this.applyMarkets(
      parsed.fixtureId,
      objectValue(parsed.match.market),
      [],
      true,
      parsed.occurredAt,
      parsed.sourceEventId,
      "indonesian"
    );
  }

  private ingestStompFrame(frame: string) {
    const parsed = parseEightXBetOddsDiffFrame(frame);
    if (!parsed) {
      return;
    }
    this.lastOddsMessageAtMs = Date.now();
    this.formatObservationCount += 1;
    this.latestOddsDestination = parsed.destination;
    this.priceDisplay = parsed.priceDisplay;
    if (parsed.priceDisplay !== "pd1") {
      this.formatUnhealthyReason = parsed.priceDisplay
        ? `unexpected odds destination ${parsed.priceDisplay}`
        : "odds destination did not include a price-display suffix";
      return;
    }

    const rawSamples = rawOddsSamplesFromMarkets(parsed.markets);
    if (rawSamples.some((value) => value < 0)) {
      this.formatUnhealthyReason = "pd1 contained negative raw odds; refusing to guess the odds format";
      return;
    }
    const availableSamples = rawSamples.filter((value) => value > 0);
    if (availableSamples.length > 0) {
      this.rawOddsSamples = [...this.rawOddsSamples, ...availableSamples].slice(-8);
    }
    if (this.formatUnhealthyReason) {
      return;
    }

    this.applyMarkets(
      parsed.fixtureId,
      parsed.markets,
      parsed.removedMarkets,
      parsed.full,
      parsed.occurredAt,
      parsed.sourceEventId,
      "indonesian"
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
      rebuildMarketSelections(current, current.seenMarkets);
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
    const metadata = {
      fixtureId,
      homeTeam: String(home.name ?? current.metadata?.homeTeam ?? "").trim(),
      awayTeam: String(away.name ?? current.metadata?.awayTeam ?? "").trim(),
      leagueName: String(value.tnName ?? current.metadata?.leagueName ?? "").trim(),
      eventStartAt:
        optionalTimestampOf(value.kickoffTime ?? value.kickoff) ??
        current.metadata?.eventStartAt
    };
    const metadataChanged =
      current.retired || !fixtureMetadataEqual(current.metadata, metadata);
    current.metadata = metadata;
    current.retired = false;
    if (!metadataChanged) {
      return;
    }
    rebuildMarketSelections(current, current.seenMarkets);
    if (current.seenMarkets.size > 0) {
      for (const code of current.seenMarkets) {
        current.pendingMarkets.add(code);
      }
      this.emitFixture(fixtureId);
    }
  }

  private applyMarkets(
    fixtureId: string,
    markets: Record<string, unknown>,
    removedMarkets: string[],
    full: boolean,
    occurredAt: string,
    sourceEventId: string,
    oddsFormat: "indonesian"
  ) {
    if (
      this.activeMetadataFixtureIds &&
      !this.activeMetadataFixtureIds.has(fixtureId)
    ) {
      return;
    }
    const current = this.ensureState(fixtureId);
    current.retired = false;
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
    current.sourceEventId = sourceEventId;
    current.oddsFormat = oddsFormat;
    current.lastEventFull = full;
    current.lastTouchedMarkets = Array.from(touchedMarkets);
    rebuildMarketSelections(current, touchedMarkets);
    this.logCoverage();
    for (const code of touchedMarkets) {
      current.pendingMarkets.add(code);
    }
    this.emitFixture(fixtureId);
  }

  private emitFixture(fixtureId: string) {
    if (!this.listener) {
      return;
    }

    this.pendingFixtureIds.add(fixtureId);
    if (this.deliveryRunning) {
      return;
    }

    this.deliveryRunning = true;
    this.deliveryQueue = this.deliveryQueue
      .then(() => this.drainFixtureDeliveries())
      .catch((error) => {
        console.warn("[8xbet-network] fixture delivery queue failed:", error);
      })
      .finally(() => {
        this.deliveryRunning = false;
        const nextFixtureId = this.pendingFixtureIds.values().next().value;
        if (typeof nextFixtureId === "string" && this.listener) {
          this.emitFixture(nextFixtureId);
        }
      });
  }

  private async drainFixtureDeliveries() {
    while (this.listener && this.pendingFixtureIds.size > 0) {
      const fixtureIds = Array.from(this.pendingFixtureIds);
      this.pendingFixtureIds.clear();

      for (const fixtureId of fixtureIds) {
        const listener = this.listener;
        const state = this.fixtures.get(fixtureId);
        if (!listener || !state?.metadata || state.pendingMarkets.size === 0) {
          continue;
        }

        const touchedMarkets = new Set(state.pendingMarkets);
        state.pendingMarkets.clear();
        const previous = selectDeliveredMarkets(state, touchedMarkets);
        const selections = selectionsForMarkets(state, touchedMarkets);
        const snapshot = this.fixtureSnapshot(fixtureId, state, selections);
        const deltas = buildDeltas(snapshot, previous, selectionMap(selections));
        this.logTelemetry(fixtureId, state);

        try {
          if (deltas.length > 0) {
            await listener(deltas, fixtureId);
          }
          replaceDeliveredMarkets(state, touchedMarkets, selections);
          const retryTimer = this.deliveryRetryTimers.get(fixtureId);
          if (retryTimer) {
            clearTimeout(retryTimer);
            this.deliveryRetryTimers.delete(fixtureId);
          }
          if (state.retired && state.deliveredSelections.size === 0) {
            this.fixtures.delete(fixtureId);
          }
        } catch (error) {
          for (const code of touchedMarkets) {
            state.pendingMarkets.add(code);
          }
          this.scheduleDeliveryRetry(fixtureId);
          console.warn(`[8xbet-network] fixture delivery failed fixture=${fixtureId}:`, error);
        }
      }
    }
  }

  private ensureState(fixtureId: string) {
    let state = this.fixtures.get(fixtureId);
    if (!state) {
      state = {
        markets: new Map(),
        seenMarkets: new Set(),
        selectionsByMarket: new Map(),
        deliveredSelections: new Map(),
        pendingMarkets: new Set(),
        occurredAt: new Date().toISOString(),
        lastEventFull: false,
        lastTouchedMarkets: [],
        sourceEventId: "",
        oddsFormat: "indonesian",
        retired: false
      };
      this.fixtures.set(fixtureId, state);
    }
    return state;
  }

  private fixtureSnapshot(
    _fixtureId: string,
    state: FeedFixtureState,
    selections: OddsSelection[]
  ): OddsSnapshot {
    return {
      source: {
        collectorId: this.collectorId,
        bookmakerId: "8xbet",
        lobbyId: "default"
      },
      collectedAt: state.occurredAt || new Date().toISOString(),
      selections
    };
  }

  private applyMetadataSnapshot(matches: Record<string, unknown>[], totalFixtureCount: number) {
    const active = new Set<string>();
    for (const match of matches) {
      const fixtureId = stringID(match.iid);
      if (!fixtureId) continue;
      active.add(fixtureId);
      this.applyMetadata(match);
    }

    this.retireFixturesMissingFromMetadata(active);
    this.metadataFixtureTotal = totalFixtureCount;
    this.activeMetadataFixtureIds = active;
    this.logCoverage();
    this.notifyActiveFixtures();
  }

  private retireFixturesMissingFromMetadata(active: Set<string>) {
    for (const [fixtureId, state] of this.fixtures) {
      if (active.has(fixtureId) || state.retired) {
        continue;
      }

      if (!this.listener || !state.metadata || state.deliveredSelections.size === 0) {
        this.fixtures.delete(fixtureId);
        continue;
      }

      state.retired = true;
      state.occurredAt = new Date().toISOString();
      const retiringMarkets = new Set(state.seenMarkets);
      for (const selection of state.deliveredSelections.values()) {
        const code = marketCodeForSelection(selection);
        if (code) retiringMarkets.add(code);
      }
      for (const code of retiringMarkets) {
        state.markets.delete(code);
        state.selectionsByMarket.set(code, []);
        state.pendingMarkets.add(code);
      }
      this.emitFixture(fixtureId);
    }
  }

  private notifyActiveFixtures() {
    if (!this.activeFixtureListener || !this.activeMetadataFixtureIds) {
      return;
    }

    const fixtureIds = Array.from(this.activeMetadataFixtureIds).sort();
    const signature = fixtureIds.join(",");
    if (signature === this.lastNotifiedFixtureSignature) {
      return;
    }
    this.lastNotifiedFixtureSignature = signature;
    void Promise.resolve(this.activeFixtureListener(fixtureIds)).catch((error) => {
      this.lastNotifiedFixtureSignature = "";
      console.warn("[8xbet-network] metadata subscription sync failed:", error);
    });
  }

  private scheduleDeliveryRetry(fixtureId: string) {
    if (this.deliveryRetryTimers.has(fixtureId)) {
      return;
    }
    const timer = setTimeout(() => {
      this.deliveryRetryTimers.delete(fixtureId);
      this.emitFixture(fixtureId);
    }, 1_000);
    timer.unref();
    this.deliveryRetryTimers.set(fixtureId, timer);
  }

  private logTelemetry(fixtureId: string, state: FeedFixtureState) {
    if (!envBool("EIGHTXBET_STREAM_TELEMETRY", true)) {
      return;
    }
    const now = Date.now();
    const intervalMs = Math.max(envInt("EIGHTXBET_STREAM_TELEMETRY_MS", 5_000), 1_000);
    if (now - this.lastTelemetryAt < intervalMs) {
      return;
    }
    this.lastTelemetryAt = now;
    const sourceLagMs = Math.max(now - new Date(state.occurredAt).getTime(), 0);
    console.log(
      `[8xbet-network] event fixture=${fixtureId} mode=${state.lastEventFull ? "init" : "update"}` +
        ` markets=${state.lastTouchedMarkets.join(",")}` +
        ` outcomes=${selectionCount(state)} source_lag_ms=${sourceLagMs}`
    );
  }

  private logCoverage() {
    if (!envBool("EIGHTXBET_COVERAGE_TELEMETRY", true)) {
      return;
    }
    const stats = this.coverageStats();
    const signature = Object.values(stats).join("|");
    const now = Date.now();
    const intervalMs = Math.max(envInt("EIGHTXBET_COVERAGE_TELEMETRY_MS", 30_000), 5_000);
    if (signature === this.lastCoverageSignature && now - this.lastCoverageAt < intervalMs) {
      return;
    }
    this.lastCoverageSignature = signature;
    this.lastCoverageAt = now;
    console.log(
      `[8xbet-network] coverage metadata=${stats.metadataFixtures}` +
        ` decoded=${stats.decodedFixtures}` +
        ` with_quotes=${stats.fixturesWithQuotes}` +
        ` pending=${stats.pendingFixtures}` +
        ` filtered=${stats.filteredFixtures}`
    );
  }
}

function rebuildMarketSelections(
  state: FeedFixtureState,
  marketCodes: Iterable<SupportedMarketCode>
) {
  for (const code of marketCodes) {
    state.selectionsByMarket.set(code, buildMarketSelections(state, code));
  }
}

function buildMarketSelections(state: FeedFixtureState, code: SupportedMarketCode) {
  if (!state.metadata) return [];
  const market = state.markets.get(code);
  if (!Array.isArray(market)) return [];
  return code === "ah" || code === "ah_1st"
    ? buildHandicapSelections(state, code, market)
    : buildOverUnderSelections(state, code, market);
}

function allSelections(state: FeedFixtureState) {
  const result: OddsSelection[] = [];
  for (const code of supportedMarketCodes) {
    result.push(...(state.selectionsByMarket.get(code) ?? []));
  }
  return result;
}

function selectionsForMarkets(
  state: FeedFixtureState,
  marketCodes: Iterable<SupportedMarketCode>
) {
  const result: OddsSelection[] = [];
  for (const code of marketCodes) {
    result.push(...(state.selectionsByMarket.get(code) ?? []));
  }
  return result;
}

function selectionMap(selections: OddsSelection[]) {
  return new Map(selections.map((selection) => [selection.outcomeId, selection]));
}

function selectDeliveredMarkets(
  state: FeedFixtureState,
  marketCodes: Set<SupportedMarketCode>
) {
  const result = new Map<string, OddsSelection>();
  for (const [outcomeId, selection] of state.deliveredSelections) {
    const code = marketCodeForSelection(selection);
    if (code && marketCodes.has(code)) {
      result.set(outcomeId, selection);
    }
  }
  return result;
}

function replaceDeliveredMarkets(
  state: FeedFixtureState,
  marketCodes: Set<SupportedMarketCode>,
  selections: OddsSelection[]
) {
  for (const [outcomeId, selection] of state.deliveredSelections) {
    const code = marketCodeForSelection(selection);
    if (code && marketCodes.has(code)) {
      state.deliveredSelections.delete(outcomeId);
    }
  }
  for (const selection of selections) {
    state.deliveredSelections.set(selection.outcomeId, selection);
  }
}

function marketCodeForSelection(selection: OddsSelection): SupportedMarketCode | null {
  switch (selection.marketId) {
    case "hdp-ah":
      return "ah";
    case "hdp-ah-1st":
      return "ah_1st";
    case "o-u-ou":
      return "ou";
    case "o-u-ou-1st":
      return "ou_1st";
    default:
      return null;
  }
}

function selectionCount(state: FeedFixtureState) {
  let count = 0;
  for (const selections of state.selectionsByMarket.values()) {
    count += selections.length;
  }
  return count;
}

function buildHandicapSelections(
  state: FeedFixtureState,
  code: "ah" | "ah_1st",
  lines: unknown[]
) {
  const metadata = state.metadata!;
  const marketId = code === "ah" ? "hdp-ah" : "hdp-ah-1st";
  const result: OddsSelection[] = [];
  for (const rawLine of lines) {
    const line = objectValue(rawLine);
    const lineValue = normalizeAsianLine(String(line.k ?? ""));
    const homeRawOdds = parseRawFeedOdds(line.h);
    const awayRawOdds = parseRawFeedOdds(line.a);
    const homeOdds = normalizeIndonesianToMalayOdds(homeRawOdds);
    const awayOdds = normalizeIndonesianToMalayOdds(awayRawOdds);
    if (!lineValue || homeOdds === null || awayOdds === null || homeRawOdds === null || awayRawOdds === null) {
      continue;
    }
    const homeOutcome = `${metadata.homeTeam} ${lineValue}`.trim();
    const awayOutcome = `${metadata.awayTeam} ${invertAsianLine(lineValue)}`.trim();
    result.push(
      selectionOf(state, marketId, homeOutcome, homeOdds, homeRawOdds),
      selectionOf(state, marketId, awayOutcome, awayOdds, awayRawOdds)
    );
  }
  return result;
}

function buildOverUnderSelections(
  state: FeedFixtureState,
  code: "ou" | "ou_1st",
  lines: unknown[]
) {
  const metadata = state.metadata!;
  const marketId = code === "ou" ? "o-u-ou" : "o-u-ou-1st";
  const result: OddsSelection[] = [];
  for (const rawLine of lines) {
    const line = objectValue(rawLine);
    const lineValue = String(line.k ?? "").trim();
    const overRawOdds = parseRawFeedOdds(line.ov);
    const underRawOdds = parseRawFeedOdds(line.ud);
    const overOdds = normalizeIndonesianToMalayOdds(overRawOdds);
    const underOdds = normalizeIndonesianToMalayOdds(underRawOdds);
    if (!lineValue || overOdds === null || underOdds === null || overRawOdds === null || underRawOdds === null) {
      continue;
    }
    result.push(
      selectionOf(state, marketId, `Over ${lineValue}`, overOdds, overRawOdds),
      selectionOf(state, marketId, `Under ${lineValue}`, underOdds, underRawOdds)
    );
  }
  return result;
}

function selectionOf(
  state: FeedFixtureState,
  marketId: string,
  outcomeName: string,
  odds: number,
  rawOdds: number
): OddsSelection {
  const metadata = state.metadata!;
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
    suspended: false,
    sourceEventId: state.sourceEventId,
    rawOdds,
    oddsFormat: state.oddsFormat
  };
}

function parseRawFeedOdds(value: unknown) {
  const parsed = Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function rawOddsSamplesFromMarkets(markets: Record<string, unknown>) {
  const result: number[] = [];
  for (const [rawCode, rawMarket] of Object.entries(markets)) {
    const code = normalizeMarketCode(rawCode);
    if (!code || !Array.isArray(rawMarket)) {
      continue;
    }
    const fields = code === "ah" || code === "ah_1st"
      ? ["h", "a"]
      : ["ov", "ud"];
    for (const rawLine of rawMarket) {
      const line = objectValue(rawLine);
      for (const field of fields) {
        const value = Number.parseFloat(String(line[field] ?? ""));
        if (Number.isFinite(value)) {
          result.push(value);
        }
        if (result.length >= 8) {
          return result;
        }
      }
    }
  }
  return result;
}

export function normalizeIndonesianToMalayOdds(value: number | null) {
  if (value === null || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  const malay = value > 1 ? -1 / value : value;
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
      destination,
      fixtureId,
      markets: objectValue(objectBody.market),
      removedMarkets: stringArray(objectBody.removeMarket),
      full: String(objectBody.sendType ?? "").toUpperCase() === "INIT",
      occurredAt: timestampOf(objectBody.nwTimestamp ?? objectBody._msgId),
      sourceEventId: String(objectBody._msgId ?? objectBody.nwTimestamp ?? "").trim(),
      priceDisplay: priceDisplayFromDestination(destination)
    };
  } catch {
    return null;
  }
}

export function parseEightXBetFullMatchPayload(payload: unknown) {
  const root = objectValue(payload);
  if (Number(root.code ?? 0) !== 0) {
    return null;
  }
  const match = extractMatchResponse(root);
  if (!match) {
    return null;
  }
  const fixtureId = stringID(match.iid);
  if (!fixtureId) {
    return null;
  }
  const eventValue = root.nwTimestamp ?? match.nwTimestamp ?? root.time ?? match.time ?? match.timestamp;
  return {
    fixtureId,
    match,
    occurredAt: timestampOf(eventValue),
    sourceEventId: String(eventValue ?? "").trim()
  };
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
    selectionsByMarket: new Map(),
    deliveredSelections: new Map(),
    pendingMarkets: new Set(),
    occurredAt: options.occurredAt,
    lastEventFull: true,
    lastTouchedMarkets: [],
    sourceEventId: options.occurredAt,
    oddsFormat: "indonesian",
    retired: false
  };
  for (const [rawCode, market] of Object.entries(options.markets)) {
    const code = normalizeMarketCode(rawCode);
    if (!code) continue;
    state.seenMarkets.add(code);
    state.markets.set(code, market);
  }
  rebuildMarketSelections(state, state.seenMarkets);
  return {
    source: {
      collectorId: options.collectorId ?? "8xbet",
      bookmakerId: "8xbet" as const,
      lobbyId: "default" as const
    },
    collectedAt: options.occurredAt,
    selections: allSelections(state)
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

export function parseEightXBetStandardFixtures(payload: unknown) {
  return extractTournamentMatches(objectValue(payload)).filter(isStandardFootballFixture);
}

function isValidTournamentMetadataSnapshot(payload: Record<string, unknown>) {
  const data = objectValue(payload.data);
  return Number(payload.code ?? 0) === 0 && Array.isArray(data.tournaments);
}

function isStandardFootballFixture(match: Record<string, unknown>) {
  if (match.inplay === false || match.specialsTournament === true) {
    return false;
  }
  const homeTeam = String(objectValue(match.home).name ?? "").trim();
  const awayTeam = String(objectValue(match.away).name ?? "").trim();
  const leagueName = String(match.tnName ?? "").trim();
  if (!stringID(match.iid) || !homeTeam || !awayTeam || !leagueName) {
    return false;
  }

  const league = filterText(leagueName);
  const participants = filterText(`${homeTeam} ${awayTeam}`);
  if (
    /\b(corners?|corner kicks?|bookings?|cards?|e\s?soccer|e\s?football|exotic|specials?|virtual)\b/.test(
      league
    ) ||
    /\bsingle team\b/.test(league) ||
    /\bspecific\s+\d+\s+mins?\b/.test(league) ||
    /\b(no of corners?|\d+(st|nd|rd|th) corner|\d{1,2}\s*\d{2}\s+\d{1,2}\s*\d{2})\b/.test(
      participants
    ) ||
    /\b(over|under)\s*$/.test(filterText(homeTeam)) ||
    /\b(over|under)\s*$/.test(filterText(awayTeam))
  ) {
    return false;
  }

  return true;
}

function filterText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

function fixtureMetadataEqual(
  left: EightXBetFixtureMetadata | undefined,
  right: EightXBetFixtureMetadata
) {
  return (
    left?.fixtureId === right.fixtureId &&
    left.homeTeam === right.homeTeam &&
    left.awayTeam === right.awayTeam &&
    left.leagueName === right.leagueName &&
    left.eventStartAt === right.eventStartAt
  );
}

function optionalTimestampOf(value: unknown) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return undefined;
  }
  return timestampOf(value);
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

function priceDisplayFromDestination(destination: string) {
  return destination.match(/\/topic\/odds-diff\/match\/\d+\/(pd\d+)(?:\/|$)/i)?.[1]?.toLowerCase() ?? "";
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
