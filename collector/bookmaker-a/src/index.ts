import type { Collector, OddsSnapshot } from "@surebet/collector-shared/src/contracts.js";

export class BookmakerACollector implements Collector {
  async collect(): Promise<OddsSnapshot> {
    return {
      source: {
        collectorId: "bookmaker-a",
        bookmakerId: "bookmaker-a",
        lobbyId: "default"
      },
      collectedAt: new Date().toISOString(),
      selections: []
    };
  }
}

