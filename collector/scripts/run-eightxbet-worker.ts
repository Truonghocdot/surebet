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
const sessionRefreshCooldownMs = Number.parseInt(
  envString("EIGHTXBET_SESSION_REFRESH_COOLDOWN_MS", "60000"),
  10
);

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
        homeTeam: selection.homeTeam,
        awayTeam: selection.awayTeam,
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
      homeTeam: selection.homeTeam,
      awayTeam: selection.awayTeam,
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
  let lastSessionRefreshAttemptAt = 0;

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
      if (
        isRefreshableEightXBetSessionError(error) &&
        Date.now() - lastSessionRefreshAttemptAt >= sessionRefreshCooldownMs
      ) {
        lastSessionRefreshAttemptAt = Date.now();
        console.warn("[8xbet-worker] refreshing 8xbet session...");
        try {
          await collector.refreshSession();
          previous = new Map<string, OddsSelection>();
          initialized = false;
          console.warn("[8xbet-worker] session refreshed; next successful collect will bootstrap.");
        } catch (refreshError) {
          console.error("[8xbet-worker] session refresh failed:", refreshError);
        }
      }
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

function isRefreshableEightXBetSessionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return [
    "8xbet auth tokens were not restored correctly",
    "8xbet incoming list did not render after session restore",
    "8xbet session refresh failed",
    "8xbet runtime requires a prepared session",
    "8xbet session is missing"
  ].some((fragment) => message.includes(fragment));
}

main().catch((error) => {
  console.error("[8xbet-worker] fatal:", error);
  process.exit(1);
});
