import path from "node:path";
import type { Collector } from "../contracts.js";
import { BaseCollector } from "../core/base-collector.js";
import { FileSessionStateStore } from "../session/file-session-state-store.js";
import { Jun88SessionBootstrapper } from "../session/jun88-session-bootstrapper.js";
import { Jun88LobbyRuntime } from "./jun88-lobby-runtime.js";
import { StaticSettingsProvider } from "../testing/static-settings-provider.js";

const staticSettings = new StaticSettingsProvider({
  "8xbet": {
    bookmakerCode: "8xbet",
    bookmakerName: "8xbet",
    url: "https://8xbet.example.com",
    username: "8xbet.ops.primary",
    password: "Dev8xbet123!"
  },
  jun88: {
    bookmakerCode: "jun88",
    bookmakerName: "jun88",
    url: "https://jun88.example.com",
    username: "jun88.ops.primary",
    password: "DevJun88123!"
  }
});

const sessionStore = new FileSessionStateStore(path.resolve("tmp/session"));
const sessionBootstrapper = new Jun88SessionBootstrapper({
  stateStore: sessionStore,
  storageStatePath: path.resolve("tmp/session/jun88-storage-state.json"),
  lobbies: [
    { lobbyId: "lobby1", launchURL: "https://jun88-lobby1.example.com" },
    { lobbyId: "lobby2", launchURL: "https://jun88-lobby2.example.com" },
    { lobbyId: "lobby3", launchURL: "https://jun88-lobby3.example.com" }
  ]
});

export function createJun88LobbyCollector(
  collectorId: string,
  lobbyId: "lobby1" | "lobby2" | "lobby3"
): Collector {
  return new BaseCollector(
    new Jun88LobbyRuntime(collectorId, lobbyId),
    {
      settings: staticSettings,
      sessionBootstrapper
    },
    "jun88",
    lobbyId
  );
}

