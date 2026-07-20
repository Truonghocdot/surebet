import {
  applyCollectorProxyProfile,
  EightXBetRuntime,
  envInt,
  envString,
  resolveEightXBetInplayPageURL,
  syncCollectorRuntimeConfig
} from "@surebet/collector-shared";

const backendURL = envString("BACKEND_API_URL", "http://127.0.0.1:8080");

async function main() {
  process.env.EIGHTXBET_TRAFFIC_RECORDER = "true";
  const runtimeConfig = await syncCollectorRuntimeConfig(backendURL).catch(() => null);
  if (runtimeConfig) {
    applyCollectorProxyProfile(runtimeConfig);
  }

  const runtime = new EightXBetRuntime("8xbet-traffic-recorder");
  const durationMs = Math.max(envInt("EIGHTXBET_TRAFFIC_DURATION_MS", 5 * 60_000), 10_000);
  const stopTimer = setTimeout(() => {
    void runtime.close();
  }, durationMs);

  try {
    await runtime.streamSnapshots(
      { pageURL: resolveEightXBetInplayPageURL() },
      async (snapshot, mode) => {
        console.log(
          `[8xbet-traffic] ${mode} fixtures=${new Set(snapshot.selections.map((item) => item.fixtureId)).size} outcomes=${snapshot.selections.length}`
        );
      },
      async (deltas, fixtureId) => {
        const occurredAt = deltas.reduce(
          (latest, delta) => delta.collectedAt > latest ? delta.collectedAt : latest,
          ""
        );
        console.log(
          `[8xbet-traffic] delta fixture=${fixtureId} outcomes=${deltas.length} occurred_at=${occurredAt}`
        );
      }
    );
  } finally {
    clearTimeout(stopTimer);
    await runtime.close();
  }
}

main().catch((error) => {
  console.error("[8xbet-traffic] fatal:", error);
  process.exitCode = 1;
});
