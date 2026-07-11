import type { Collector } from "../contracts.js";
import { BaseCollector } from "../core/base-collector.js";
import { resolveCollectorPageURL } from "../core/page-url-resolver.js";
import { Jun88BtiRuntime } from "./jun88-bti-runtime.js";
import { Jun88CmdRuntime } from "./jun88-cmd-runtime.js";
import { Jun88SabaRuntime } from "./jun88-ibc-runtime.js";
import { Jun88M9BetRuntime } from "./jun88-m8-runtime.js";

export function createJun88LobbyCollector(
  collectorId: string,
  lobbyId: "saba" | "bti" | "cmd" | "m9bet"
): Collector {
  const runtime =
    lobbyId === "saba"
      ? new Jun88SabaRuntime(collectorId)
      : lobbyId === "cmd"
      ? new Jun88CmdRuntime(collectorId)
      : lobbyId === "m9bet"
      ? new Jun88M9BetRuntime(collectorId)
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
