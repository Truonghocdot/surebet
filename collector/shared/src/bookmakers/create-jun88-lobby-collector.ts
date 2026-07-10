import type { Collector } from "../contracts.js";
import { BaseCollector } from "../core/base-collector.js";
import { resolveCollectorPageURL } from "../core/page-url-resolver.js";
import { Jun88BtiRuntime } from "./jun88-bti-runtime.js";
import { Jun88CmdRuntime } from "./jun88-cmd-runtime.js";
import { Jun88IbcRuntime } from "./jun88-ibc-runtime.js";
import { Jun88M8Runtime } from "./jun88-m8-runtime.js";

export function createJun88LobbyCollector(
  collectorId: string,
  lobbyId: "ibc" | "bti" | "cmd" | "m8"
): Collector {
  const runtime =
    lobbyId === "ibc"
      ? new Jun88IbcRuntime(collectorId)
      : lobbyId === "cmd"
      ? new Jun88CmdRuntime(collectorId)
      : lobbyId === "m8"
      ? new Jun88M8Runtime(collectorId)
      : new Jun88BtiRuntime(collectorId);

  return new BaseCollector(
    runtime,
    {
      pageURL: resolveCollectorPageURL("jun88", lobbyId)
    },
    "jun88",
    lobbyId
  );
}
