import {
  buildDeltas,
  EightXBetRuntime,
  heartbeatIntervalMs,
  heartbeatOf,
  resolveEightXBetInplayPageURL,
  type Collector,
  type CollectorSink,
  type OddsSelection,
  type OddsSnapshot
} from "@surebet/collector-shared";

export class EightXBetCollector implements Collector {
  private readonly inplayRuntime = new EightXBetRuntime("8xbet-inplay");
  private readonly inplayPageURL = resolveEightXBetInplayPageURL();

  async collect() {
    const inplay = await this.inplayRuntime.collect({
      pageURL: this.inplayPageURL
    });

    return normalizeEightXBetInplaySnapshot(inplay);
  }

  async stream(sink: CollectorSink) {
    let currentSnapshot: OddsSnapshot | null = null;
    let currentSnapshotMap = new Map<string, OddsSelection>();
    let bootstrapSent = false;
    let lastHeartbeatAt = 0;

    const flushSnapshot = async (snapshot: OddsSnapshot, mode: "bootstrap" | "delta") => {
      const nextSnapshot = normalizeEightXBetInplaySnapshot(snapshot);
      const previousSummary = currentSnapshot ? summarizeSnapshot(currentSnapshot) : null;
      const nextSummary = summarizeSnapshot(nextSnapshot);
      logEightXBetSnapshotTelemetry(mode, previousSummary, nextSummary);
      if (!bootstrapSent || mode === "bootstrap" || !currentSnapshot) {
        await sink.pushBootstrap(nextSnapshot);
        currentSnapshot = nextSnapshot;
        currentSnapshotMap = selectionMap(nextSnapshot);
        bootstrapSent = true;
        await maybeHeartbeat(nextSnapshot);
        return;
      }

      const nextSnapshotMap = selectionMap(nextSnapshot);
      const deltas = buildDeltas(
        nextSnapshot,
        currentSnapshotMap,
        nextSnapshotMap
      );
      if (deltas.length > 0) {
        await sink.pushDelta(deltas);
      }
      currentSnapshot = nextSnapshot;
      currentSnapshotMap = nextSnapshotMap;
      await maybeHeartbeat(nextSnapshot);
    };

    const maybeHeartbeat = async (snapshot: OddsSnapshot) => {
      if (Date.now() - lastHeartbeatAt < heartbeatIntervalMs()) {
        return;
      }

      await sink.heartbeat(heartbeatOf(snapshot.source));
      lastHeartbeatAt = Date.now();
    };

    const heartbeatTimer = setInterval(() => {
      if (!bootstrapSent || !currentSnapshot) {
        return;
      }

      if (Date.now() - lastHeartbeatAt < heartbeatIntervalMs()) {
        return;
      }

      void sink.heartbeat(heartbeatOf(currentSnapshot.source)).then(() => {
        lastHeartbeatAt = Date.now();
      });
    }, Math.max(Math.floor(heartbeatIntervalMs() / 2), 1_000));

    const inplayTask = this.inplayRuntime.streamSnapshots(
      {
        pageURL: this.inplayPageURL
      },
      async (snapshot, mode) => {
        await flushSnapshot(snapshot, mode);
      }
    );

    try {
      await inplayTask;
    } finally {
      clearInterval(heartbeatTimer);
      await this.inplayRuntime.close();
    }
  }
}

function normalizeEightXBetInplaySnapshot(inplay: OddsSnapshot): OddsSnapshot {
  return {
    source: {
      collectorId: "8xbet",
      bookmakerId: "8xbet",
      lobbyId: "default"
    },
    collectedAt: new Date().toISOString(),
    selections: inplay.selections.map((selection) => ({
      fixtureId: selection.fixtureId,
      sport: selection.sport,
      homeTeam: selection.homeTeam,
      awayTeam: selection.awayTeam,
      leagueName: selection.leagueName,
      matchState: "live",
      eventStartAt: selection.eventStartAt,
      marketId: selection.marketId,
      outcomeId: selection.outcomeId,
      outcomeName: selection.outcomeName,
      odds: selection.odds,
      availableStake: selection.availableStake,
      suspended: selection.suspended
    }))
  };
}

function selectionMap(snapshot: OddsSnapshot) {
  const map = new Map<string, OddsSelection>();
  for (let i = 0; i < snapshot.selections.length; i++) {
    const selection = snapshot.selections[i];
    map.set(selection.outcomeId, selection);
  }
  return map;
}

function summarizeSnapshot(snapshot: OddsSnapshot) {
  const fixtures = new Set<string>();
  const markets = new Set<string>();
  for (let i = 0; i < snapshot.selections.length; i++) {
    const sel = snapshot.selections[i];
    fixtures.add(sel.fixtureId);
    markets.add(`${sel.fixtureId}|${sel.marketId}`);
  }
  const outcomes = snapshot.selections.length;
  return { fixtures: fixtures.size, markets: markets.size, outcomes };
}

function logEightXBetSnapshotTelemetry(
  mode: "bootstrap" | "delta",
  previous: { fixtures: number; markets: number; outcomes: number } | null,
  next: { fixtures: number; markets: number; outcomes: number }
) {
  console.log(
    `[8xbet-worker] snapshot mode=${mode}` +
      ` fixtures=${previous?.fixtures ?? 0}->${next.fixtures}` +
      ` markets=${previous?.markets ?? 0}->${next.markets}` +
      ` outcomes=${previous?.outcomes ?? 0}->${next.outcomes}`
  );
}
