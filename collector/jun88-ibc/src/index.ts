import {
  createJun88LobbyCollector,
  type Collector
} from "@surebet/collector-shared";

export class Jun88SabaCollector implements Collector {
  private readonly base = createJun88LobbyCollector("jun88-saba", "saba");

  async collect() {
    return this.base.collect();
  }
}

export class Jun88IbcCollector extends Jun88SabaCollector {}

export class Jun88Lobby1Collector extends Jun88SabaCollector {}
