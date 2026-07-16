import type { Collector } from "../contracts.js";
import { BaseCollector } from "../core/base-collector.js";
import { resolveCollectorPageURL } from "../core/page-url-resolver.js";
import { Jun88CmdRuntime } from "./jun88-cmd-runtime.js";

export function createJun88LobbyCollector(
  collectorId: string,
  lobbyId: "cmd"
): Collector {
  const runtime = new Jun88CmdRuntime(collectorId);

  return new BaseCollector(
    runtime,
    {
      pageURL: resolveCollectorPageURL("jun88", lobbyId)
    },
    "jun88",
    lobbyId
  );
}
