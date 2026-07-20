import {
  EightXBetRuntime,
  heartbeatIntervalMs,
  heartbeatOf,
  resolveEightXBetInplayPageURL,
  type CollectorSink,
  type OddsDelta,
  type OddsSnapshot
} from "@surebet/collector-shared";

export class EightXBetCollector {
  private readonly inplayRuntime = new EightXBetRuntime("8xbet");
  private readonly inplayPageURL = resolveEightXBetInplayPageURL();

  async stream(sink: CollectorSink) {
    let currentSnapshot: OddsSnapshot | null = null;
    let bootstrapSent = false;
    let lastHeartbeatAt = 0;

    const flushSnapshot = async (snapshot: OddsSnapshot, mode: "bootstrap" | "delta") => {
      const previousSummary = currentSnapshot ? summarizeSnapshot(currentSnapshot) : null;
      const nextSummary = summarizeSnapshot(snapshot);
      logEightXBetSnapshotTelemetry(mode, previousSummary, nextSummary);
      await sink.pushBootstrap(snapshot);
      currentSnapshot = snapshot;
      bootstrapSent = true;
      await maybeHeartbeat(snapshot);
    };

    const flushFixtureDeltas = async (deltas: OddsDelta[]) => {
      if (deltas.length === 0 || !bootstrapSent || !currentSnapshot) {
        return;
      }

      await sink.pushDelta(deltas);
      currentSnapshot = {
        ...currentSnapshot,
        collectedAt: latestDeltaTimestamp(deltas, currentSnapshot.collectedAt)
      };
      await maybeHeartbeat(currentSnapshot);
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
      async (deltas) => {
        await flushFixtureDeltas(deltas);
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

function latestDeltaTimestamp(deltas: OddsDelta[], fallback: string) {
  let latest = Date.parse(fallback);
  for (const delta of deltas) {
    const value = Date.parse(delta.collectedAt);
    if (Number.isFinite(value) && (!Number.isFinite(latest) || value > latest)) {
      latest = value;
    }
  }
  return Number.isFinite(latest) ? new Date(latest).toISOString() : fallback;
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
