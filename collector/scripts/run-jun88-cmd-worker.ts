import {
  applyCollectorProxyProfile,
  BackendCollectorStreamSink,
  envString,
  logCollectorProxyDebug,
  syncCollectorRuntimeConfig
} from "@surebet/collector-shared";
import { Jun88CmdCollector } from "../jun88-cmd/src/index.js";

const backendURL = envString("BACKEND_API_URL", "http://127.0.0.1:8080");

async function main() {
  const sink = new BackendCollectorStreamSink(backendURL, {
    collectorId: "jun88-cmd",
    bookmakerId: "jun88",
    lobbyId: "cmd"
  });

  while (true) {
    try {
      await runWorker(sink);
    } catch (error) {
      console.error("[jun88-cmd-worker] fatal loop error:", error);
      await sleep(2_000);
    }
  }
}

async function runWorker(sink: BackendCollectorStreamSink) {
  const runtimeConfig = await syncCollectorRuntimeConfig(backendURL).catch((error) => {
    console.warn("[jun88-cmd-worker] collector runtime config sync failed:", error);
    return null;
  });

  if (runtimeConfig) {
    applyCollectorProxyProfile(runtimeConfig);
  }

  const collector = new Jun88CmdCollector();
  logCollectorProxyDebug("jun88-cmd");
  console.log("[jun88-cmd-worker] starting in streaming mode");
  await collector.stream(sink);
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error("[jun88-cmd-worker] fatal:", error);
  process.exit(1);
});
