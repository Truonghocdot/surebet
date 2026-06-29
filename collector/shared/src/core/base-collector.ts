import type {
  BookmakerCode,
  BookmakerSettingsProvider,
  Collector,
  CollectorSink,
  CollectorRuntime,
  LobbyCode,
  StreamingCollectorRuntime,
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

  async stream(sink: CollectorSink) {
    if (!isStreamingRuntime(this.runtime)) {
      throw new Error(`collector ${this.bookmakerCode}/${this.lobbyId} does not support streaming`);
    }

    const setting = await this.deps.settings.getBookmakerSetting(this.bookmakerCode);
    const session =
      this.bookmakerCode === "jun88" && this.deps.sessionBootstrapper
        ? await this.deps.sessionBootstrapper.prepare(setting)
        : undefined;

    return this.runtime.stream(
      {
        setting,
        session
      },
      sink
    );
  }

  getLobbyId() {
    return this.lobbyId;
  }
}

function isStreamingRuntime(runtime: CollectorRuntime): runtime is StreamingCollectorRuntime {
  return typeof (runtime as StreamingCollectorRuntime).stream === "function";
}
