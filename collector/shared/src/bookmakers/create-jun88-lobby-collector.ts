import path from "node:path";
import type { Collector } from "../contracts.js";
import { BaseCollector } from "../core/base-collector.js";
import { createBackendSettingsProvider } from "../core/backend-provider-factory.js";
import { FileSessionStateStore } from "../session/file-session-state-store.js";
import { Jun88SessionBootstrapper } from "../session/jun88-session-bootstrapper.js";
import { Jun88BtiRuntime } from "./jun88-bti-runtime.js";
import { Jun88CmdRuntime } from "./jun88-cmd-runtime.js";
import { Jun88IbcRuntime } from "./jun88-ibc-runtime.js";
import { Jun88LobbyRuntime } from "./jun88-lobby-runtime.js";
import { Jun88M8Runtime } from "./jun88-m8-runtime.js";
import { JUN88_LOBBIES } from "./jun88-lobbies.js";

const sessionStore = new FileSessionStateStore(path.resolve("tmp/session"));
const sessionBootstrapper = new Jun88SessionBootstrapper({
  stateStore: sessionStore,
  storageStatePath: path.resolve("tmp/session/jun88-storage-state.json"),
  lobbies: JUN88_LOBBIES
});

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
      : lobbyId === "bti"
      ? new Jun88BtiRuntime(collectorId)
      : new Jun88LobbyRuntime(collectorId, lobbyId);

  return new BaseCollector(
    runtime,
    {
      settings: createBackendSettingsProvider(),
      sessionBootstrapper
    },
    "jun88",
    lobbyId
  );
}
