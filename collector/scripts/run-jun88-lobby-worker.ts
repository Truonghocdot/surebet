import {
  BackendCollectorSink,
  createJun88LobbyCollector,
  envString,
  type LobbyCode,
  type OddsDelta,
  type OddsSelection,
  type OddsSnapshot
} from "@surebet/collector-shared";

const backendURL = envString("BACKEND_API_URL", "http://127.0.0.1:8080");
const intervalMs = Number.parseInt(envString("COLLECT_INTERVAL_MS", "5000"), 10);
const heartbeatMs = Number.parseInt(envString("COLLECT_HEARTBEAT_MS", "15000"), 10);

const lobbyCollectorIDs: Record<Exclude<LobbyCode, "default">, string> = {
  bti: "jun88-bti",
  ibc: "jun88-ibc",
  cmd: "jun88-cmd",
  m8: "jun88-m8"
};

export async function runJun88LobbyWorker(lobbyId: Exclude<LobbyCode, "default">) {
  const sink = new BackendCollectorSink(backendURL);
  const collectorId = lobbyCollectorIDs[lobbyId];

  while (true) {
    try {
      await runWorker(lobbyId, collectorId, sink);
    } catch (error) {
      console.error(`[${collectorId}-worker] fatal loop error:`, error);
      await sleep(2_000);
    }
  }
}

function selectionMap(snapshot: OddsSnapshot) {
  return new Map(snapshot.selections.map((selection) => [selection.outcomeId, selection]));
}

function buildDeltas(
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

async function runWorker(
  lobbyId: Exclude<LobbyCode, "default">,
  collectorId: string,
  sink: BackendCollectorSink
) {
  const collector = createJun88LobbyCollector(collectorId, lobbyId);

  if ("stream" in collector && typeof collector.stream === "function") {
    console.log(`[${collectorId}-worker] starting in streaming mode`);
    await collector.stream(sink);
    return;
  }

  let previous = new Map<string, OddsSelection>();
  let initialized = false;
  let lastHeartbeatAt = 0;

  while (true) {
    const startedAt = Date.now();

    try {
      const snapshot = await collector.collect();

      if (!initialized) {
        await sink.pushBootstrap(snapshot);
        previous = selectionMap(snapshot);
        initialized = true;
      } else {
        const next = selectionMap(snapshot);
        const deltas = buildDeltas(snapshot, previous, next);
        if (deltas.length > 0) {
          await sink.pushDelta(deltas);
        }
        previous = next;
      }

      if (Date.now() - lastHeartbeatAt >= heartbeatMs) {
        await sink.heartbeat({
          collectorId: snapshot.source.collectorId,
          bookmakerId: snapshot.source.bookmakerId,
          lobbyId: snapshot.source.lobbyId,
          sentAt: new Date().toISOString()
        });
        lastHeartbeatAt = Date.now();
      }
    } catch (error) {
      console.error(`[${collectorId}-worker] collect failed:`, error);
    }

    const elapsed = Date.now() - startedAt;
    const waitMs = Math.max(intervalMs - elapsed, 250);
    await sleep(waitMs);
  }
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
