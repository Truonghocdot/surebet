import {
  Jun88CmdRuntime,
  configuredSimulatedPlaceBetHandler,
  resolveJun88CmdPageURL,
  type CollectorSink
} from "@surebet/collector-shared";

export class Jun88CmdCollector {
  private readonly runtime = new Jun88CmdRuntime("jun88-cmd");
  private readonly pageURL = resolveJun88CmdPageURL();

  async stream(sink: CollectorSink) {
    sink.setSimulatedPlaceBetHandler?.(configuredSimulatedPlaceBetHandler("jun88"));
    try {
      return await this.runtime.stream({ pageURL: this.pageURL }, sink);
    } finally {
      sink.setSimulatedPlaceBetHandler?.(null);
    }
  }
}
