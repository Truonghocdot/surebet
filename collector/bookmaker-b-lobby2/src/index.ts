import {
  createJun88LobbyCollector,
  type Collector
} from "@surebet/collector-shared";

export class Jun88Lobby2Collector implements Collector {
  private readonly base = createJun88LobbyCollector("jun88-lobby2", "lobby2");

  async collect() {
    return this.base.collect();
  }
}
