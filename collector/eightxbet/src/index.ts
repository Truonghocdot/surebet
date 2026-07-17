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
  private readonly inplayRuntime = new EightXBetRuntime("8xbet");
  private readonly inplayPageURL = resolveEightXBetInplayPageURL();

  async collect() {
    const inplay = await this.inplayRuntime.collect({
      pageURL: this.inplayPageURL
    });

    return inplay;
  }

  async stream(sink: CollectorSink) {
    let currentSnapshot: OddsSnapshot | null = null;
    let currentSnapshotMap = new Map<string, OddsSelection>();
    let bootstrapSent = false;
    let lastHeartbeatAt = 0;
    let activeDeltaScan:
      | {
          seenFixtureIds: Set<string>;
        }
      | null = null;

    const flushSnapshot = async (snapshot: OddsSnapshot, mode: "bootstrap" | "delta") => {
      const nextSnapshot = snapshot;
      const previousSummary = currentSnapshot ? summarizeSnapshot(currentSnapshot) : null;
      const nextSummary = summarizeSnapshot(nextSnapshot);
      logEightXBetSnapshotTelemetry(mode, previousSummary, nextSummary);
      if (!bootstrapSent || mode === "bootstrap" || !currentSnapshot) {
        await sink.pushBootstrap(nextSnapshot);
        currentSnapshot = nextSnapshot;
        currentSnapshotMap = selectionMap(nextSnapshot);
        bootstrapSent = true;
        activeDeltaScan = null;
        await maybeHeartbeat(nextSnapshot);
        return;
      }

      const nextSnapshotMap = selectionMap(nextSnapshot);
      const deltas = buildDisappearedFixtureDeltas(
        nextSnapshot,
        currentSnapshotMap,
        nextSnapshotMap,
        activeDeltaScan?.seenFixtureIds ?? new Set<string>()
      );
      if (deltas.length > 0) {
        await sink.pushDelta(deltas);
      }
      currentSnapshot = nextSnapshot;
      currentSnapshotMap = nextSnapshotMap;
      activeDeltaScan = null;
      await maybeHeartbeat(nextSnapshot);
    };

    const flushFixtureSnapshot = async (
      snapshot: OddsSnapshot,
      mode: "bootstrap" | "delta",
      fixtureId: string
    ) => {
      if (mode !== "delta" || !bootstrapSent || !currentSnapshot) {
        return;
      }

      if (!activeDeltaScan) {
        activeDeltaScan = {
          seenFixtureIds: new Set<string>()
        };
      }

      activeDeltaScan.seenFixtureIds.add(fixtureId);
      const previousFixtureMap = selectFixtureOutcomes(currentSnapshotMap, fixtureId);
      const nextFixtureMap = selectionMap(snapshot);
      const deltas = buildDeltas(snapshot, previousFixtureMap, nextFixtureMap);
      if (deltas.length > 0) {
        await sink.pushDelta(deltas);
      }
      replaceFixtureOutcomes(currentSnapshotMap, fixtureId, nextFixtureMap);
      currentSnapshot = {
        ...currentSnapshot,
        collectedAt: snapshot.collectedAt,
        selections: Array.from(currentSnapshotMap.values())
      };
      sink.setResyncSnapshot?.(currentSnapshot);
      await maybeHeartbeat(snapshot);
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
      }).catch((error) => {
        console.warn("[8xbet-worker] heartbeat failed:", error);
      });
    }, Math.max(Math.floor(heartbeatIntervalMs() / 2), 1_000));

    sink.setQuoteConfirmationHandler?.((request) => this.inplayRuntime.confirmQuote(request));
    const inplayTask = this.inplayRuntime.streamSnapshots(
      {
        pageURL: this.inplayPageURL
      },
      async (snapshot, mode) => {
        await flushSnapshot(snapshot, mode);
      },
      async (snapshot, mode, fixtureId) => {
        await flushFixtureSnapshot(snapshot, mode, fixtureId);
      }
    );

    try {
      await inplayTask;
    } finally {
      sink.setQuoteConfirmationHandler?.(null);
      clearInterval(heartbeatTimer);
      await this.inplayRuntime.close();
    }
  }
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

function selectFixtureOutcomes(snapshotMap: Map<string, OddsSelection>, fixtureId: string) {
  const map = new Map<string, OddsSelection>();
  for (const [outcomeId, selection] of snapshotMap.entries()) {
    if (selection.fixtureId !== fixtureId) {
      continue;
    }
    map.set(outcomeId, selection);
  }
  return map;
}

function replaceFixtureOutcomes(
  snapshotMap: Map<string, OddsSelection>,
  fixtureId: string,
  nextFixtureMap: Map<string, OddsSelection>
) {
  for (const [outcomeId, selection] of snapshotMap.entries()) {
    if (selection.fixtureId === fixtureId) {
      snapshotMap.delete(outcomeId);
    }
  }
  for (const [outcomeId, selection] of nextFixtureMap.entries()) {
    snapshotMap.set(outcomeId, selection);
  }
}

function buildDisappearedFixtureDeltas(
  snapshot: OddsSnapshot,
  previous: Map<string, OddsSelection>,
  next: Map<string, OddsSelection>,
  seenFixtureIds: Set<string>
) {
  const deltas = [];
  for (const [outcomeId, selection] of previous.entries()) {
    if (next.has(outcomeId) || seenFixtureIds.has(selection.fixtureId)) {
      continue;
    }

    deltas.push({
      source: snapshot.source,
      collectedAt: snapshot.collectedAt,
      fixtureId: selection.fixtureId,
      sport: selection.sport,
      homeTeam: selection.homeTeam,
      awayTeam: selection.awayTeam,
      leagueName: selection.leagueName,
      matchState: selection.matchState,
      eventStartAt: selection.eventStartAt,
      marketId: selection.marketId,
      outcomeId: selection.outcomeId,
      outcomeName: selection.outcomeName,
      odds: selection.odds,
      availableStake: selection.availableStake,
      suspended: true,
      op: "remove" as const
    });
  }
  return deltas;
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
