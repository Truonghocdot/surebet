import {
  createJun88LobbyCollector,
  type Collector
} from "@surebet/collector-shared";

export class Jun88Lobby3Collector implements Collector {
  private readonly base = createJun88LobbyCollector("jun88-lobby3", "lobby3");

  async collect() {
    return this.base.collect();
  }
}
