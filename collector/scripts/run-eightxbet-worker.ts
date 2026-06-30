import {
  BackendCollectorSink,
  envString,
  type OddsDelta,
  type OddsSelection,
  type OddsSnapshot
} from "@surebet/collector-shared";
import { EightXBetCollector } from "../eightxbet/src/index.js";

const backendURL = envString("BACKEND_API_URL", "http://127.0.0.1:8080");
const intervalMs = Number.parseInt(envString("COLLECT_INTERVAL_MS", "5000"), 10);
const heartbeatMs = Number.parseInt(envString("COLLECT_HEARTBEAT_MS", "15000"), 10);

async function main() {
  const sink = new BackendCollectorSink(backendURL);
  await runWorkerSafely(sink);
}

function selectionMap(snapshot: OddsSnapshot) {
  return new Map(snapshot.selections.map((selection) => [selection.outcomeId, selection]));
}

function buildDeltas(
  snapshot: OddsSnapshot,
  previous: Map<string, OddsSelection>,
  next: Map<string, OddsSelection>
) {
  const deltas: OddsDelta[] = [];

  for (const [outcomeId, selection] of next.entries()) {
    const prev = previous.get(outcomeId);
    if (
      !prev ||
      prev.odds !== selection.odds ||
      prev.availableStake !== selection.availableStake ||
      prev.suspended !== selection.suspended
    ) {
      deltas.push({
        source: snapshot.source,
        collectedAt: snapshot.collectedAt,
        fixtureId: selection.fixtureId,
        marketId: selection.marketId,
        outcomeId: selection.outcomeId,
        outcomeName: selection.outcomeName,
        odds: selection.odds,
        availableStake: selection.availableStake,
        suspended: selection.suspended,
        op: "upsert"
      });
    }
  }

  for (const [outcomeId, selection] of previous.entries()) {
    if (next.has(outcomeId)) {
      continue;
    }

    deltas.push({
      source: snapshot.source,
      collectedAt: snapshot.collectedAt,
      fixtureId: selection.fixtureId,
      marketId: selection.marketId,
      outcomeId: selection.outcomeId,
      outcomeName: selection.outcomeName,
      odds: selection.odds,
      availableStake: selection.availableStake,
      suspended: true,
      op: "remove"
    });
  }

  return deltas;
}

async function runWorker(sink: BackendCollectorSink) {
  const collector = new EightXBetCollector();
  let previous = new Map<string, OddsSelection>();
  let initialized = false;
  let lastHeartbeatAt = 0;

  while (true) {
    const startedAt = Date.now();

    try {
      const snapshot = await collector.collect();

      if (!initialized) {
        console.log("[8xbet-worker] pushing bootstrap...");
        await sink.pushBootstrap(snapshot);
        previous = selectionMap(snapshot);
        initialized = true;
      } else {
        const next = selectionMap(snapshot);
        const deltas = buildDeltas(snapshot, previous, next);
        if (deltas.length > 0) {
          console.log(`[8xbet-worker] pushing ${deltas.length} deltas...`);
          await sink.pushDelta(deltas);
        } else {
          console.log("[8xbet-worker] no changes detected.");
        }
        previous = next;
      }

      if (Date.now() - lastHeartbeatAt >= heartbeatMs) {
        await sink.heartbeat({
          collectorId: snapshot.source.collectorId,
          bookmakerId: snapshot.source.bookmakerId,
          lobbyId: snapshot.source.lobbyId,
          sentAt: new Date().toISOString()
        });
        lastHeartbeatAt = Date.now();
        console.log("[8xbet-worker] heartbeat sent.");
      }
    } catch (error) {
      console.error("[8xbet-worker] collect failed:", error);
    }

    const elapsed = Date.now() - startedAt;
    const waitMs = Math.max(intervalMs - elapsed, 500);
    await sleep(waitMs);
  }
}

async function runWorkerSafely(sink: BackendCollectorSink) {
  while (true) {
    try {
      await runWorker(sink);
    } catch (error) {
      console.error("[8xbet-worker] fatal loop error:", error);
      await sleep(2_000);
    }
  }
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error("[8xbet-worker] fatal:", error);
  process.exit(1);
});
