import {
  Jun88CmdRuntime,
  resolveJun88CmdPageURL,
  type CollectorSink
} from "@surebet/collector-shared";

export class Jun88CmdCollector {
  private readonly runtime = new Jun88CmdRuntime("jun88-cmd");
  private readonly pageURL = resolveJun88CmdPageURL();

  async stream(sink: CollectorSink) {
    return this.runtime.stream({ pageURL: this.pageURL }, sink);
  }
}
