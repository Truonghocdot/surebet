import path from "node:path";
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
      return existing;
    }

    const preparedState: SessionState = {
      bookmakerCode: "jun88",
      originURL: setting.url,
      bootstrapMode: "manual",
      preparedAt: new Date().toISOString(),
      storageStatePath: path.resolve(this.options.storageStatePath),
      accessibleLobbies: this.options.lobbies.map((item) => item.lobbyId)
    };

    await this.options.stateStore.write(preparedState);
    return preparedState;
  }
}

