import {
  BackendCollectorStreamSink,
  envString,
  applyCollectorProxyProfile,
  logCollectorProxyDebug,
  startCollectorProxyCacheRefresh,
  syncCollectorRuntimeConfig
} from "@surebet/collector-shared";
import { EightXBetCollector } from "../eightxbet/src/index.js";

const backendURL = envString("BACKEND_API_URL", "http://127.0.0.1:8080");

async function main() {
  const sink = new BackendCollectorStreamSink(backendURL, {
    collectorId: "8xbet",
    bookmakerId: "8xbet",
    lobbyId: "default"
  });
  await runWorkerSafely(sink);
}

async function runWorker(sink: BackendCollectorStreamSink) {
  const runtimeConfig = await syncCollectorRuntimeConfig(backendURL).catch((error) => {
    console.warn("[8xbet-worker] collector runtime config sync failed:", error);
    return null;
  });
  if (runtimeConfig) {
    applyCollectorProxyProfile(runtimeConfig);
  }

  logCollectorProxyDebug("8xbet");

  const collector = new EightXBetCollector();
  const stopProxyRefresh = startCollectorProxyCacheRefresh("8xbet");
  console.log("[8xbet-worker] starting in streaming mode");
  try {
    await collector.stream(sink);
  } finally {
    stopProxyRefresh();
  }
}

async function runWorkerSafely(sink: BackendCollectorStreamSink) {
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
