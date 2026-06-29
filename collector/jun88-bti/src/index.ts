import {
  createJun88LobbyCollector,
  type Collector
} from "@surebet/collector-shared";

export class Jun88BtiCollector implements Collector {
  private readonly base = createJun88LobbyCollector("jun88-bti", "bti");

  async collect() {
    return this.base.collect();
  }
}

export class Jun88Lobby2Collector extends Jun88BtiCollector {}
