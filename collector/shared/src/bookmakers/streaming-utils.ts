import type {
  CollectorHeartbeat,
  CollectorSource,
  OddsDelta,
  OddsSelection,
  OddsSnapshot
} from "../contracts.js";

export function selectionMap(snapshot: OddsSnapshot) {
  return new Map(snapshot.selections.map((selection) => [selection.outcomeId, selection]));
}

export function buildDeltas(
  snapshot: OddsSnapshot,
  previous: Map<string, OddsSelection>,
  next: Map<string, OddsSelection>
) {
  const deltas: OddsDelta[] = [];

  for (const [outcomeId, selection] of next.entries()) {
    const prev = previous.get(outcomeId);
    if (
      !prev ||
      prev.odds !== selection.odds ||
      prev.availableStake !== selection.availableStake ||
      prev.suspended !== selection.suspended
    ) {
      deltas.push({
        source: snapshot.source,
        collectedAt: snapshot.collectedAt,
        fixtureId: selection.fixtureId,
        marketId: selection.marketId,
        outcomeId: selection.outcomeId,
        outcomeName: selection.outcomeName,
        odds: selection.odds,
        availableStake: selection.availableStake,
        suspended: selection.suspended,
        op: "upsert"
      });
    }
  }

  for (const [outcomeId, selection] of previous.entries()) {
    if (next.has(outcomeId)) {
      continue;
    }

    deltas.push({
      source: snapshot.source,
      collectedAt: snapshot.collectedAt,
      fixtureId: selection.fixtureId,
      marketId: selection.marketId,
      outcomeId: selection.outcomeId,
      outcomeName: selection.outcomeName,
      odds: selection.odds,
      availableStake: selection.availableStake,
      suspended: true,
      op: "remove"
    });
  }

  return deltas;
}

export function heartbeatOf(source: CollectorSource): CollectorHeartbeat {
  return {
    collectorId: source.collectorId,
    bookmakerId: source.bookmakerId,
    lobbyId: source.lobbyId,
    sentAt: new Date().toISOString()
  };
}
