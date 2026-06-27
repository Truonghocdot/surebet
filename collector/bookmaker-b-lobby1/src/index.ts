import type { Collector, OddsSnapshot } from "@surebet/collector-shared/src/contracts.js";

export class BookmakerBLobby1Collector implements Collector {
  async collect(): Promise<OddsSnapshot> {
    return {
      source: {
        collectorId: "bookmaker-b-lobby1",
        bookmakerId: "bookmaker-b",
        lobbyId: "lobby1"
      },
      collectedAt: new Date().toISOString(),
      selections: []
    };
  }
}

