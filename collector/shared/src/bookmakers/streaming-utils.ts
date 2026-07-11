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
        homeTeam: selection.homeTeam,
        awayTeam: selection.awayTeam,
        leagueName: selection.leagueName,
        matchState: selection.matchState,
        eventStartAt: selection.eventStartAt,
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
      homeTeam: selection.homeTeam,
      awayTeam: selection.awayTeam,
      leagueName: selection.leagueName,
      matchState: selection.matchState,
      eventStartAt: selection.eventStartAt,
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

export function assertSnapshotHasSelections(snapshot: OddsSnapshot, label = snapshot.source.collectorId) {
  if (snapshot.selections.length === 0) {
    throw new Error(
      `[${label}] parsed 0 selections. Lobby is reachable, but no odds rows were extracted.`
    );
  }
}
