import {
  createJun88LobbyCollector,
  type Collector
} from "@surebet/collector-shared";

export class Jun88M9BetCollector implements Collector {
  private readonly base = createJun88LobbyCollector("jun88-m9bet", "m9bet");

  async collect() {
    return this.base.collect();
  }
}

export class Jun88M8Collector extends Jun88M9BetCollector {}

export class Jun88Lobby4Collector extends Jun88M9BetCollector {}
