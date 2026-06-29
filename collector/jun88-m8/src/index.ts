import {
  createJun88LobbyCollector,
  type Collector
} from "@surebet/collector-shared";

export class Jun88M8Collector implements Collector {
  private readonly base = createJun88LobbyCollector("jun88-m8", "m8");

  async collect() {
    return this.base.collect();
  }
}

export class Jun88Lobby4Collector extends Jun88M8Collector {}
