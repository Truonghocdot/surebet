import {
  BackendCollectorStreamSink,
  envString,
  logCollectorProxyDebug,
  startCollectorResourceTelemetry,
  syncCollectorRuntimeConfig
} from "@surebet/collector-shared";
import { Jun88CmdCollector } from "../jun88-cmd/src/index.js";

const backendURL = envString("BACKEND_API_URL", "http://127.0.0.1:8080");

installTimestampedConsole();
process.env.COLLECTOR_PROXY_MODE = "off";

async function main() {
  const sink = new BackendCollectorStreamSink(backendURL, {
    collectorId: "jun88-cmd",
    bookmakerId: "jun88",
    lobbyId: "cmd"
  });
  logCollectorProxyDebug("jun88-cmd");
  startCollectorResourceTelemetry("jun88-cmd");

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
  await syncCollectorRuntimeConfig(backendURL, { applyProxy: false }).catch((error) => {
    console.warn("[jun88-cmd-worker] collector runtime config sync failed:", error);
  });

  const collector = new Jun88CmdCollector();
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

function installTimestampedConsole() {
  const originalLog = console.log.bind(console);
  const originalWarn = console.warn.bind(console);
  const originalError = console.error.bind(console);
  const timestamp = () => `[${new Date().toISOString()}]`;

  console.log = (...args: unknown[]) => originalLog(timestamp(), ...args);
  console.warn = (...args: unknown[]) => originalWarn(timestamp(), ...args);
  console.error = (...args: unknown[]) => originalError(timestamp(), ...args);
}
