import {
  EightXBetRuntime,
  resolveCollectorPageURL,
  resolveEightXBetInplayPageURL,
  type Collector,
  type OddsSelection,
  type OddsSnapshot
} from "@surebet/collector-shared";

export class EightXBetCollector implements Collector {
  private readonly incomingRuntime = new EightXBetRuntime("8xbet");
  private readonly inplayRuntime = new EightXBetRuntime("8xbet-inplay");
  private readonly incomingPageURL = resolveCollectorPageURL("8xbet", "default");
  private readonly inplayPageURL = resolveEightXBetInplayPageURL();

  async collect() {
    const incoming = await this.incomingRuntime.collect({
      pageURL: this.incomingPageURL
    });
    const inplay = await this.inplayRuntime.collect({
      pageURL: this.inplayPageURL
    });

    return mergeEightXBetSnapshots(incoming, inplay);
  }
}

function mergeEightXBetSnapshots(incoming: OddsSnapshot, inplay: OddsSnapshot): OddsSnapshot {
  const selectionsByOutcome = new Map<string, OddsSelection>();
  for (const selection of incoming.selections) {
    selectionsByOutcome.set(selection.outcomeId, selection);
  }
  for (const selection of inplay.selections) {
    selectionsByOutcome.set(selection.outcomeId, {
      ...selection,
      matchState: "live"
    });
  }

  return {
    source: {
      collectorId: "8xbet",
      bookmakerId: "8xbet",
      lobbyId: "default"
    },
    collectedAt: new Date().toISOString(),
    selections: Array.from(selectionsByOutcome.values())
  };
}
