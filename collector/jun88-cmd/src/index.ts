import {
  createJun88LobbyCollector,
  type Collector
} from "@surebet/collector-shared";

export class Jun88CmdCollector implements Collector {
  private readonly base = createJun88LobbyCollector("jun88-cmd", "cmd");

  async collect() {
    return this.base.collect();
  }
}

export class Jun88Lobby3Collector extends Jun88CmdCollector {}
