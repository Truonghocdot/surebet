import { access } from "node:fs/promises";
import type {
  BookmakerSetting,
  Jun88LobbyAccess,
  SessionBootstrapper,
  SessionState,
  SessionStateStore
} from "../contracts.js";

type Jun88BootstrapOptions = {
  stateStore: SessionStateStore;
  storageStatePath: string;
  lobbies: Jun88LobbyAccess[];
};

export class Jun88SessionBootstrapper implements SessionBootstrapper {
  constructor(private readonly options: Jun88BootstrapOptions) {}

  async prepare(setting: BookmakerSetting): Promise<SessionState> {
    const existing = await this.options.stateStore.read("jun88");
    if (existing) {
      await access(existing.storageStatePath);
      return existing;
    }

    throw new Error(
      [
        `Jun88 shared session is missing for ${setting.bookmakerName}.`,
        "Run the manual bootstrap script first to create a storage state file.",
        "Suggested command: npm run bootstrap:jun88"
      ].join(" ")
    );
  }
}
