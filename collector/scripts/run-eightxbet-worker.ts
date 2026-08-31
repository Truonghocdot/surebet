import {
  BackendCollectorStreamSink,
  envString,
  startCollectorResourceTelemetry,
  syncCollectorRuntimeConfig
} from "@surebet/collector-shared";
import { EightXBetCollector } from "../eightxbet/src/index.js";

const backendURL = envString("BACKEND_API_URL", "http://127.0.0.1:8080");
const source = { collectorId: "8xbet", bookmakerId: "8xbet", lobbyId: "default" } as const;

async function main() {
  const sink = new BackendCollectorStreamSink(backendURL, {
    ...source
  });
  startCollectorResourceTelemetry("8xbet");
  await runWorkerSafely(sink);
}

async function runWorker(sink: BackendCollectorStreamSink) {
  await syncCollectorRuntimeConfig(backendURL, { source }).catch((error) => {
    console.warn("[8xbet-worker] collector runtime config sync failed:", error);
  });

  const collector = new EightXBetCollector();
  console.log("[8xbet-worker] starting in streaming mode");
  await collector.stream(sink);
}

async function runWorkerSafely(sink: BackendCollectorStreamSink) {
  let consecutiveFailures = 0;
  while (true) {
    const startedAt = Date.now();
    try {
      await runWorker(sink);
    } catch (error) {
      console.error("[8xbet-worker] fatal loop error:", error);
      if (Date.now() - startedAt >= 60_000) {
        consecutiveFailures = 0;
      }
      consecutiveFailures += 1;
      const retryMs = Math.min(2_000 * 2 ** (consecutiveFailures - 1), 60_000);
      console.warn(`[8xbet-worker] retrying in ${retryMs}ms`);
      await sleep(retryMs);
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
