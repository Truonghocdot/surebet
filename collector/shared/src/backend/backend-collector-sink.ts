import type {
  CollectorHeartbeat,
  CollectorSink,
  OddsDelta,
  OddsSnapshot
} from "../contracts.js";
import { formatError } from "../core/debug.js";

export class BackendCollectorSink implements CollectorSink {
  constructor(private readonly backendURL: string) {}

  async pushBootstrap(snapshot: OddsSnapshot): Promise<void> {
    await this.post("/v1/collector/bootstrap", serializeSnapshot(snapshot));
  }

  async pushDelta(deltas: OddsDelta[]): Promise<void> {
    await this.post("/v1/collector/delta", {
      deltas: deltas.map(serializeDelta)
    });
  }

  async heartbeat(payload: CollectorHeartbeat): Promise<void> {
    await this.post("/v1/collector/heartbeat", {
      collector_id: payload.collectorId,
      bookmaker_id: payload.bookmakerId,
      lobby_id: payload.lobbyId,
      sent_at: payload.sentAt
    });
  }

  private async post(path: string, body: unknown) {
    try {
      const response = await fetch(`${this.backendURL.replace(/\/+$/, "")}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`Collector sink request failed: ${response.status} ${path} ${text}`);
      }
    } catch (error) {
      throw new Error(
        `Collector sink POST ${path} failed against ${this.backendURL}: ${formatError(error)}`
      );
    }
  }
}

function serializeSnapshot(snapshot: OddsSnapshot) {
  return {
    source: {
      collector_id: snapshot.source.collectorId,
      bookmaker_id: snapshot.source.bookmakerId,
      lobby_id: snapshot.source.lobbyId
    },
    collected_at: snapshot.collectedAt,
    selections: snapshot.selections.map((selection) => ({
      fixture_id: selection.fixtureId,
      market_id: selection.marketId,
      outcome_id: selection.outcomeId,
      outcome_name: selection.outcomeName,
      odds: selection.odds,
      available_stake: selection.availableStake,
      suspended: selection.suspended
    }))
  };
}

function serializeDelta(delta: OddsDelta) {
  return {
    source: {
      collector_id: delta.source.collectorId,
      bookmaker_id: delta.source.bookmakerId,
      lobby_id: delta.source.lobbyId
    },
    collected_at: delta.collectedAt,
    fixture_id: delta.fixtureId,
    market_id: delta.marketId,
    outcome_id: delta.outcomeId,
    outcome_name: delta.outcomeName,
    odds: delta.odds,
    available_stake: delta.availableStake,
    suspended: delta.suspended,
    op: delta.op
  };
}
