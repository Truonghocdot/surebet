import type {
  BookmakerCode,
  BookmakerSettingsProvider,
  Collector,
  CollectorRuntime,
  LobbyCode,
  SessionBootstrapper
} from "../contracts.js";

type BaseCollectorDependencies = {
  settings: BookmakerSettingsProvider;
  sessionBootstrapper?: SessionBootstrapper;
};

export class BaseCollector implements Collector {
  constructor(
    private readonly runtime: CollectorRuntime,
    private readonly deps: BaseCollectorDependencies,
    private readonly bookmakerCode: BookmakerCode,
    private readonly lobbyId: LobbyCode
  ) {}

  async collect() {
    const setting = await this.deps.settings.getBookmakerSetting(this.bookmakerCode);
    const session =
      this.bookmakerCode === "jun88" && this.deps.sessionBootstrapper
        ? await this.deps.sessionBootstrapper.prepare(setting)
        : undefined;

    return this.runtime.collect({
      setting,
      session
    });
  }

  getLobbyId() {
    return this.lobbyId;
  }
}

