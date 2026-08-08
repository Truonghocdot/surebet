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

    const flushSnapshot = async (
      snapshot: OddsSnapshot,
      mode: "bootstrap" | "observation"
    ) => {
      await deliverEightXBetSnapshot(sink, snapshot, mode);
      if (mode === "bootstrap") {
        bootstrapSent = true;
      }
      currentSnapshot = snapshot;
      await maybeHeartbeat(snapshot);
    };

    const flushFixtureDeltas = async (
      deltas: OddsDelta[],
      fixtureId: string,
      observedAt: string
    ) => {
      if (!bootstrapSent || !currentSnapshot) {
        return;
      }

      if (deltas.length === 0) {
        await sink.observeFixtureMarketBatch?.(fixtureId, observedAt);
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
      async (deltas, fixtureId, observedAt) => {
        await flushFixtureDeltas(deltas, fixtureId, observedAt);
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

export async function deliverEightXBetSnapshot(
  sink: CollectorSink,
  snapshot: OddsSnapshot,
  mode: "bootstrap" | "observation"
) {
  if (mode === "bootstrap") {
    await sink.pushBootstrap(snapshot);
    return;
  }

  const fixtureIds = Array.from(
    new Set(snapshot.selections.map((selection) => selection.fixtureId))
  );
  if (sink.observeFixtureMarketBatches) {
    await sink.observeFixtureMarketBatches(fixtureIds, snapshot.collectedAt);
    return;
  }
  for (const fixtureId of fixtureIds) {
    await sink.observeFixtureMarketBatch?.(fixtureId, snapshot.collectedAt);
  }
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
