import {
  createJun88LobbyCollector,
  type Collector
} from "@surebet/collector-shared";

export class Jun88IbcCollector implements Collector {
  private readonly base = createJun88LobbyCollector("jun88-ibc", "ibc");

  async collect() {
    return this.base.collect();
  }
}

export class Jun88Lobby1Collector extends Jun88IbcCollector {}
