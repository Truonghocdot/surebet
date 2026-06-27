import type { Collector, OddsSnapshot } from "@surebet/collector-shared/src/contracts.js";

export class BookmakerBLobby3Collector implements Collector {
  async collect(): Promise<OddsSnapshot> {
    return {
      source: {
        collectorId: "bookmaker-b-lobby3",
        bookmakerId: "bookmaker-b",
        lobbyId: "lobby3"
      },
      collectedAt: new Date().toISOString(),
      selections: []
    };
  }
}

