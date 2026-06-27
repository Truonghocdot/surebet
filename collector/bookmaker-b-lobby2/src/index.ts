import type { Collector, OddsSnapshot } from "@surebet/collector-shared/src/contracts.js";

export class BookmakerBLobby2Collector implements Collector {
  async collect(): Promise<OddsSnapshot> {
    return {
      source: {
        collectorId: "bookmaker-b-lobby2",
        bookmakerId: "bookmaker-b",
        lobbyId: "lobby2"
      },
      collectedAt: new Date().toISOString(),
      selections: []
    };
  }
}

