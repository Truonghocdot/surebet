import {
  buildDeltas,
  EightXBetRuntime,
  heartbeatIntervalMs,
  heartbeatOf,
  resolveCollectorPageURL,
  resolveEightXBetInplayPageURL,
  type Collector,
  type CollectorSink,
  type OddsSelection,
  type OddsSnapshot
} from "@surebet/collector-shared";

export class EightXBetCollector implements Collector {
  private readonly incomingRuntime = new EightXBetRuntime("8xbet");
  private readonly inplayRuntime = new EightXBetRuntime("8xbet-inplay");
  private readonly incomingPageURL = resolveCollectorPageURL("8xbet", "default");
  private readonly inplayPageURL = resolveEightXBetInplayPageURL();

  async collect() {
    const incoming = await this.incomingRuntime.collect({
      pageURL: this.incomingPageURL
    });
    const inplay = await this.inplayRuntime.collect({
      pageURL: this.inplayPageURL
    });

    return mergeEightXBetSnapshots(incoming, inplay);
  }

  async stream(sink: CollectorSink) {
    let latestIncoming: OddsSnapshot | null = null;
    let latestInplay: OddsSnapshot | null = null;
    let mergedSnapshot: OddsSnapshot | null = null;
    let mergedSnapshotMap = new Map<string, OddsSelection>();
    let bootstrapSent = false;
    let lastHeartbeatAt = 0;

    const flushSnapshot = async (
      channel: "incoming" | "inplay",
      snapshot: OddsSnapshot,
      mode: "bootstrap" | "delta"
    ) => {
      if (channel === "incoming") {
        latestIncoming = snapshot;
      } else {
        latestInplay = snapshot;
      }

      if (!latestIncoming || !latestInplay) {
        return;
      }

      const nextMerged = mergeEightXBetSnapshots(latestIncoming, latestInplay);
      const previousSummary = mergedSnapshot ? summarizeSnapshot(mergedSnapshot) : null;
      const nextSummary = summarizeSnapshot(nextMerged);
      logEightXBetMergeTelemetry(channel, mode, previousSummary, nextSummary);
      if (!bootstrapSent || mode === "bootstrap" || !mergedSnapshot) {
        await sink.pushBootstrap(nextMerged);
        mergedSnapshot = nextMerged;
        mergedSnapshotMap = selectionMap(nextMerged);
        bootstrapSent = true;
        await maybeHeartbeat(nextMerged);
        return;
      }

      const nextMergedMap = selectionMap(nextMerged);
      const deltas = buildDeltas(
        nextMerged,
        mergedSnapshotMap,
        nextMergedMap
      );
      if (deltas.length > 0) {
        await sink.pushDelta(deltas);
      }
      mergedSnapshot = nextMerged;
      mergedSnapshotMap = nextMergedMap;
      await maybeHeartbeat(nextMerged);
    };

    const maybeHeartbeat = async (snapshot: OddsSnapshot) => {
      if (Date.now() - lastHeartbeatAt < heartbeatIntervalMs()) {
        return;
      }

      await sink.heartbeat(heartbeatOf(snapshot.source));
      lastHeartbeatAt = Date.now();
    };

    const heartbeatTimer = setInterval(() => {
      if (!bootstrapSent || !mergedSnapshot) {
        return;
      }

      if (Date.now() - lastHeartbeatAt < heartbeatIntervalMs()) {
        return;
      }

      void sink.heartbeat(heartbeatOf(mergedSnapshot.source)).then(() => {
        lastHeartbeatAt = Date.now();
      });
    }, Math.max(Math.floor(heartbeatIntervalMs() / 2), 1_000));

    const incomingTask = this.incomingRuntime.streamSnapshots(
      {
        pageURL: this.incomingPageURL
      },
      async (snapshot, mode) => {
        await flushSnapshot("incoming", snapshot, mode);
      }
    );
    const inplayTask = this.inplayRuntime.streamSnapshots(
      {
        pageURL: this.inplayPageURL
      },
      async (snapshot, mode) => {
        await flushSnapshot("inplay", snapshot, mode);
      }
    );

    try {
      await Promise.race([incomingTask, inplayTask]);
    } finally {
      clearInterval(heartbeatTimer);
      await Promise.allSettled([this.incomingRuntime.close(), this.inplayRuntime.close()]);
      await Promise.allSettled([incomingTask, inplayTask]);
    }
  }
}

function mergeEightXBetSnapshots(incoming: OddsSnapshot, inplay: OddsSnapshot): OddsSnapshot {
  const selectionsByOutcome = new Map<string, OddsSelection>();
  for (const selection of incoming.selections) {
    selectionsByOutcome.set(selection.outcomeId, selection);
  }
  for (let i = 0; i < inplay.selections.length; i++) {
    const selection = inplay.selections[i];
    selectionsByOutcome.set(selection.outcomeId, {
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
    });
  }

  return {
    source: {
      collectorId: "8xbet",
      bookmakerId: "8xbet",
      lobbyId: "default"
    },
    collectedAt: new Date().toISOString(),
    selections: Array.from(selectionsByOutcome.values())
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

function logEightXBetMergeTelemetry(
  channel: "incoming" | "inplay",
  mode: "bootstrap" | "delta",
  previous: { fixtures: number; markets: number; outcomes: number } | null,
  next: { fixtures: number; markets: number; outcomes: number }
) {
  console.log(
    `[8xbet-worker] merge channel=${channel} mode=${mode}` +
      ` fixtures=${previous?.fixtures ?? 0}->${next.fixtures}` +
      ` markets=${previous?.markets ?? 0}->${next.markets}` +
      ` outcomes=${previous?.outcomes ?? 0}->${next.outcomes}`
  );
}
