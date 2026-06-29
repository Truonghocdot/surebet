import {
  createJun88LobbyCollector,
  type Collector
} from "@surebet/collector-shared";

export class Jun88Lobby1Collector implements Collector {
  private readonly base = createJun88LobbyCollector("jun88-lobby1", "lobby1");

  async collect() {
    return this.base.collect();
  }
}
