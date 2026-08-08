import {
  applyCollectorProxyProfile,
  BackendCollectorStreamSink,
  envString,
  logCollectorProxyDebug,
  syncCollectorRuntimeConfig
} from "@surebet/collector-shared";
import { Jun88CmdCollector } from "../jun88-cmd/src/index.js";

const backendURL = envString("BACKEND_API_URL", "http://127.0.0.1:8080");

installTimestampedConsole();

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

  const cmdProxyMode = envString("JUN88_CMD_PROXY_MODE", "").trim();
  if (cmdProxyMode) {
    process.env.COLLECTOR_PROXY_MODE = cmdProxyMode;
    console.log(`[jun88-cmd-worker] proxy mode override=${cmdProxyMode}`);
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

function installTimestampedConsole() {
  const originalLog = console.log.bind(console);
  const originalWarn = console.warn.bind(console);
  const originalError = console.error.bind(console);
  const timestamp = () => `[${new Date().toISOString()}]`;

  console.log = (...args: unknown[]) => originalLog(timestamp(), ...args);
  console.warn = (...args: unknown[]) => originalWarn(timestamp(), ...args);
  console.error = (...args: unknown[]) => originalError(timestamp(), ...args);
}
