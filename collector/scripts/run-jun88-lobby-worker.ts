import {
  applyCollectorProxyProfile,
  BackendCollectorStreamSink,
  createJun88LobbyCollector,
  envString,
  logCollectorProxyDebug,
  syncCollectorRuntimeConfig
} from "@surebet/collector-shared";

const backendURL = envString("BACKEND_API_URL", "http://127.0.0.1:8080");

const collectorId = "jun88-cmd";

export async function runJun88LobbyWorker(lobbyId: "cmd") {
  const sink = new BackendCollectorStreamSink(backendURL, {
    collectorId,
    bookmakerId: "jun88",
    lobbyId
  });

  while (true) {
    try {
      await runWorker(lobbyId, sink);
    } catch (error) {
      console.error(`[${collectorId}-worker] fatal loop error:`, error);
      await sleep(2_000);
    }
  }
}

async function runWorker(
  lobbyId: "cmd",
  sink: BackendCollectorStreamSink
) {
  const runtimeConfig = await syncCollectorRuntimeConfig(backendURL).catch((error) => {
    console.warn(`[${collectorId}-worker] collector runtime config sync failed:`, error);
    return null;
  });

  if (runtimeConfig) {
    applyCollectorProxyProfile(runtimeConfig);
  }

  const collector = createJun88LobbyCollector(collectorId, lobbyId);
  logCollectorProxyDebug(collectorId);
  console.log(`[${collectorId}-worker] starting in streaming mode`);
  await collector.stream(sink);
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
