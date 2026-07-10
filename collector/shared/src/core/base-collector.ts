import type {
  BookmakerCode,
  Collector,
  CollectorSink,
  CollectorRuntime,
  LobbyCode,
  StreamingCollectorRuntime
} from "../contracts.js";

type BaseCollectorDependencies = {
  pageURL: string;
};

export class BaseCollector implements Collector {
  constructor(
    private readonly runtime: CollectorRuntime,
    private readonly deps: BaseCollectorDependencies,
    private readonly bookmakerCode: BookmakerCode,
    private readonly lobbyId: LobbyCode
  ) {}

  async collect() {
    return this.runtime.collect({
      pageURL: this.deps.pageURL
    });
  }

  async stream(sink: CollectorSink) {
    if (!isStreamingRuntime(this.runtime)) {
      throw new Error(`collector ${this.bookmakerCode}/${this.lobbyId} does not support streaming`);
    }

    return this.runtime.stream(
      {
        pageURL: this.deps.pageURL
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
