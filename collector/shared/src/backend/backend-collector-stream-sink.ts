import crypto from "node:crypto";
import type {
  BookmakerCode,
  CollectorHeartbeat,
  CollectorSink,
  LobbyCode,
  OddsDelta,
  OddsSelection,
  OddsSnapshot,
  QuoteConfirmationHandler,
  QuoteConfirmationRequest
} from "../contracts.js";
import { normalizeSourceEventStartAt } from "./source-event-start-at.js";

type CollectorSourceIdentity = {
  collectorId: string;
  bookmakerId: BookmakerCode;
  lobbyId: LobbyCode;
};

type HelloAckFrame = {
  type?: string;
  session_id?: string;
};

type ResyncFrame = {
  type?: string;
  reason?: string;
};

type ErrorFrame = {
  type?: string;
  code?: string;
  message?: string;
};

type ConfirmQuoteFrame = {
  type?: string;
  request_id?: string;
  fixture_id?: string;
  market_id?: string;
  outcome_id?: string;
  timeout_ms?: number;
};

export class BackendCollectorStreamSink implements CollectorSink {
  private readonly startedAt = new Date().toISOString();
  private readonly streamURL: string;
  private latestBootstrap: OddsSnapshot | null = null;
  private readonly latestSelections = new Map<string, OddsSelection>();
  private socket: WebSocket | null = null;
  private readyPromise: Promise<void> | null = null;
  private readyResolve: (() => void) | null = null;
  private readyReject: ((error: Error) => void) | null = null;
  private sendQueue = Promise.resolve();
  private pendingResync = true;
  private sessionId = "";
  private seq = 0;
  private quoteConfirmationHandler: QuoteConfirmationHandler | null = null;

  constructor(
    backendURL: string,
    private readonly source: CollectorSourceIdentity
  ) {
    this.streamURL = buildCollectorStreamURL(backendURL);
  }

  async pushBootstrap(snapshot: OddsSnapshot): Promise<void> {
    this.replaceLatestSnapshot(snapshot);
    await this.enqueue(async () => {
      await this.ensureConnected();
      logEventStartAtNormalization(snapshot.source, snapshot.collectedAt, snapshot.selections);
      await this.sendBootstrapSnapshot(snapshot);
      this.pendingResync = false;
    });
  }

  async pushDelta(deltas: OddsDelta[]): Promise<void> {
    if (deltas.length === 0) {
      return;
    }

    this.applyLatestDeltas(deltas);
    await this.enqueue(async () => {
      await this.ensureConnected();
      await this.replayLatestBootstrapIfNeeded();

      const upserts: any[] = [];

      for (const delta of deltas) {
        logEventStartAtNormalization(delta.source, delta.collectedAt, [delta]);
        if (delta.op === "remove") {
          await this.sendFrame({
            type: "quote_remove",
            session_id: this.sessionId,
            seq: this.nextSeq(),
            occurred_at: delta.collectedAt,
            source: serializeSource(delta.source),
            raw_ids: serializeRawIDs(delta),
            markers: serializeMarkers(delta)
          });
          continue;
        }

        upserts.push({
          occurred_at: delta.collectedAt,
          raw_ids: serializeRawIDs(delta),
          markers: serializeMarkers(delta),
          quote: {
            sport: delta.sport ?? "",
            home_team: delta.homeTeam ?? "",
            away_team: delta.awayTeam ?? "",
            league_name: delta.leagueName ?? "",
            match_state: delta.matchState ?? "unknown",
            event_start_at: normalizeSourceEventStartAt(
              delta.source,
              delta.eventStartAt,
              delta.collectedAt
            ),
            outcome_name: delta.outcomeName,
            odds: delta.odds,
            available_stake: delta.availableStake,
            suspended: delta.suspended
          }
        });
      }

      for (let i = 0; i < upserts.length; i += 200) {
        const batch = upserts.slice(i, i + 200);
        await this.sendFrame({
          type: "quote_upsert_batch",
          session_id: this.sessionId,
          seq: this.nextSeq(),
          source: serializeSource(deltas[0].source),
          items: batch
        });
      }
    });
  }

  async heartbeat(payload: CollectorHeartbeat): Promise<void> {
    await this.enqueue(async () => {
      await this.ensureConnected();
      await this.replayLatestBootstrapIfNeeded();

      await this.sendFrame({
        type: "heartbeat",
        session_id: this.sessionId,
        seq: this.nextSeq(),
        sent_at: payload.sentAt
      });
    });
  }

  setQuoteConfirmationHandler(handler: QuoteConfirmationHandler | null) {
    this.quoteConfirmationHandler = handler;
  }

  private enqueue(operation: () => Promise<void>) {
    const pending = this.sendQueue.catch(() => undefined).then(operation);
    this.sendQueue = pending.catch(() => undefined);
    return pending;
  }

  private async ensureConnected() {
    if (this.socket && this.socket.readyState === WebSocket.OPEN && !this.readyPromise) {
      return;
    }

    if (!this.readyPromise) {
      this.startConnection();
    }

    await this.readyPromise;
  }

  private startConnection() {
    this.sessionId = crypto.randomUUID();
    this.seq = 0;
    this.pendingResync = true;
    this.socket = new WebSocket(this.streamURL);
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.readyResolve = () => {
        this.readyPromise = null;
        this.readyResolve = null;
        this.readyReject = null;
        resolve();
      };
      this.readyReject = (error: Error) => {
        this.readyPromise = null;
        this.readyResolve = null;
        this.readyReject = null;
        reject(error);
      };
    });

    const currentSocket = this.socket;
    currentSocket.addEventListener("open", () => {
      void this.sendRawFrame({
        type: "hello",
        protocol_version: 1,
        session_id: this.sessionId,
        source: {
          collector_id: this.source.collectorId,
          bookmaker_id: this.source.bookmakerId,
          lobby_id: this.source.lobbyId
        },
        started_at: this.startedAt
      }).catch((error) => {
        this.readyReject?.(normalizeSocketError(error));
      });
    });

    currentSocket.addEventListener("message", (event: MessageEvent) => {
      this.handleIncomingFrame(String(event.data));
    });
    currentSocket.addEventListener("error", () => {
      this.pendingResync = true;
      this.readyReject?.(new Error("collector stream socket error"));
    });
    currentSocket.addEventListener("close", () => {
      this.pendingResync = true;
      if (this.socket === currentSocket) {
        this.socket = null;
      }
      this.readyReject?.(new Error("collector stream socket closed before hello_ack"));
    });
  }

  private handleIncomingFrame(payload: string) {
    let parsed: HelloAckFrame | ResyncFrame | ErrorFrame | ConfirmQuoteFrame;

    try {
      parsed = JSON.parse(payload) as HelloAckFrame | ResyncFrame | ErrorFrame | ConfirmQuoteFrame;
    } catch {
      return;
    }

    if (parsed.type === "hello_ack" && "session_id" in parsed && parsed.session_id === this.sessionId) {
      this.readyResolve?.();
      return;
    }

    if (parsed.type === "resync_required") {
      this.pendingResync = true;
      return;
    }

    if (parsed.type === "error") {
      this.pendingResync = true;
      if ((parsed as ErrorFrame).code === "stale_session") {
        this.socket?.close();
      }
      return;
    }

    if (parsed.type === "confirm_quote") {
      void this.handleQuoteConfirmation(parsed as ConfirmQuoteFrame);
    }
  }

  private async handleQuoteConfirmation(frame: ConfirmQuoteFrame) {
    const request = parseQuoteConfirmationRequest(frame);
    if (!request) {
      return;
    }

    let observedAt = new Date().toISOString();
    let selection: OddsSelection | null = null;
    let error = "";
    try {
      if (!this.quoteConfirmationHandler) {
        throw new Error("quote confirmation is not supported by this collector");
      }
      const result = await this.quoteConfirmationHandler(request);
      observedAt = result.observedAt;
      selection = result.selection;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }

    await this.enqueue(async () => {
      await this.ensureConnected();
      await this.sendFrame({
        type: "confirm_quote_response",
        session_id: this.sessionId,
        seq: this.nextSeq(),
        request_id: request.requestId,
        observed_at: observedAt,
        found: selection !== null && !selection.suspended,
        error,
        selection: selection ? serializeConfirmedSelection(selection) : undefined
      });
    });
  }

  private async replayLatestBootstrapIfNeeded() {
    if (!this.pendingResync || !this.latestBootstrap) {
      return;
    }

    await this.sendBootstrapSnapshot({
      ...this.latestBootstrap,
      selections: Array.from(this.latestSelections.values())
    });
    this.pendingResync = false;
  }

  private replaceLatestSnapshot(snapshot: OddsSnapshot) {
    this.latestBootstrap = {
      ...snapshot,
      selections: []
    };
    this.latestSelections.clear();
    for (const selection of snapshot.selections) {
      this.latestSelections.set(selection.outcomeId, selection);
    }
  }

  private applyLatestDeltas(deltas: OddsDelta[]) {
    if (!this.latestBootstrap) {
      return;
    }

    let collectedAt = this.latestBootstrap.collectedAt;
    let collectedAtMs = Date.parse(collectedAt);
    for (const delta of deltas) {
      if (delta.op === "remove") {
        this.latestSelections.delete(delta.outcomeId);
      } else {
        this.latestSelections.set(delta.outcomeId, selectionFromDelta(delta));
      }

      const deltaAtMs = Date.parse(delta.collectedAt);
      if (Number.isFinite(deltaAtMs) && (!Number.isFinite(collectedAtMs) || deltaAtMs > collectedAtMs)) {
        collectedAt = delta.collectedAt;
        collectedAtMs = deltaAtMs;
      }
    }

    this.latestBootstrap = {
      ...this.latestBootstrap,
      collectedAt
    };
  }

  private async sendBootstrapSnapshot(snapshot: OddsSnapshot) {
    const snapshotId = crypto.randomUUID();

    await this.sendFrame({
      type: "snapshot_begin",
      session_id: this.sessionId,
      snapshot_id: snapshotId,
      seq: this.nextSeq(),
      sent_at: snapshot.collectedAt
    });

    const upserts = snapshot.selections.map((selection) => ({
      occurred_at: snapshot.collectedAt,
      raw_ids: {
        fixture_id: selection.fixtureId,
        market_id: selection.marketId,
        outcome_id: selection.outcomeId
      },
      markers: serializeMarkers(selection),
      quote: {
        sport: selection.sport ?? "",
        home_team: selection.homeTeam ?? "",
        away_team: selection.awayTeam ?? "",
        league_name: selection.leagueName ?? "",
        match_state: selection.matchState ?? "unknown",
        event_start_at: normalizeSourceEventStartAt(
          snapshot.source,
          selection.eventStartAt,
          snapshot.collectedAt
        ),
        outcome_name: selection.outcomeName,
        odds: selection.odds,
        available_stake: selection.availableStake,
        suspended: selection.suspended
      }
    }));

    for (let i = 0; i < upserts.length; i += 200) {
      const batch = upserts.slice(i, i + 200);
      await this.sendFrame({
        type: "quote_upsert_batch",
        session_id: this.sessionId,
        snapshot_id: snapshotId,
        seq: this.nextSeq(),
        source: serializeSource(snapshot.source),
        items: batch
      });
    }

    await this.sendFrame({
      type: "snapshot_commit",
      session_id: this.sessionId,
      snapshot_id: snapshotId,
      seq: this.nextSeq(),
      sent_at: snapshot.collectedAt,
      expected_count: snapshot.selections.length
    });
  }

  private async sendFrame(payload: Record<string, unknown>) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("collector stream socket is not open");
    }

    await this.sendRawFrame(payload);
  }

  private async sendRawFrame(payload: Record<string, unknown>) {
    if (!this.socket) {
      throw new Error("collector stream socket is unavailable");
    }

    this.socket.send(JSON.stringify(payload));
  }

  private nextSeq() {
    this.seq += 1;
    return this.seq;
  }
}

function parseQuoteConfirmationRequest(
  frame: ConfirmQuoteFrame
): QuoteConfirmationRequest | null {
  const requestId = String(frame.request_id ?? "").trim();
  const fixtureId = String(frame.fixture_id ?? "").trim();
  const marketId = String(frame.market_id ?? "").trim();
  const outcomeId = String(frame.outcome_id ?? "").trim();
  if (!requestId || !fixtureId || !marketId || !outcomeId) {
    return null;
  }
  return {
    requestId,
    fixtureId,
    marketId,
    outcomeId,
    timeoutMs: Math.max(Math.min(Number(frame.timeout_ms) || 2_000, 3_000), 250)
  };
}

function serializeConfirmedSelection(selection: OddsSelection) {
  return {
    fixture_id: selection.fixtureId,
    sport: selection.sport ?? "football",
    home_team: selection.homeTeam ?? "",
    away_team: selection.awayTeam ?? "",
    league_name: selection.leagueName ?? "",
    match_state: selection.matchState ?? "unknown",
    event_start_at: selection.eventStartAt ?? "",
    market_id: selection.marketId,
    outcome_id: selection.outcomeId,
    outcome_name: selection.outcomeName,
    odds: selection.odds,
    available_stake: selection.availableStake,
    suspended: selection.suspended,
    source_event_id: selection.sourceEventId ?? "",
    raw_odds: selection.rawOdds ?? 0,
    odds_format: selection.oddsFormat ?? ""
  };
}

function buildCollectorStreamURL(backendURL: string) {
  const target = new URL(backendURL);
  target.protocol = target.protocol === "https:" ? "wss:" : "ws:";
  target.pathname = "/v2/collector/stream";
  target.search = "";
  target.hash = "";
  return target.toString();
}

function serializeSource(source: CollectorSourceIdentity | OddsSnapshot["source"] | OddsDelta["source"]) {
  return {
    collector_id: source.collectorId,
    bookmaker_id: source.bookmakerId,
    lobby_id: source.lobbyId
  };
}

function serializeRawIDs(delta: OddsDelta) {
  return {
    fixture_id: delta.fixtureId,
    market_id: delta.marketId,
    outcome_id: delta.outcomeId
  };
}

function serializeMarkers(value: OddsSelection | OddsDelta) {
  return {
    fixture_marker: fixtureMarkerOf(value.homeTeam, value.awayTeam, value.fixtureId),
    market_marker: slugText(value.marketId),
    outcome_marker: slugText(value.outcomeName)
  };
}

function fixtureMarkerOf(homeTeam: string | undefined, awayTeam: string | undefined, fixtureId: string) {
  const home = slugText(homeTeam ?? "");
  const away = slugText(awayTeam ?? "");
  if (home !== "" && away !== "") {
    return `${home}|${away}`;
  }
  return slugText(fixtureId);
}

function canonicalText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugText(value: string) {
  return canonicalText(value).replace(/\s+/g, "-");
}

function normalizeSocketError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}

function selectionFromDelta(delta: OddsDelta): OddsSelection {
  return {
    fixtureId: delta.fixtureId,
    sport: delta.sport,
    homeTeam: delta.homeTeam,
    awayTeam: delta.awayTeam,
    leagueName: delta.leagueName,
    matchState: delta.matchState,
    eventStartAt: delta.eventStartAt,
    marketId: delta.marketId,
    outcomeId: delta.outcomeId,
    outcomeName: delta.outcomeName,
    odds: delta.odds,
    availableStake: delta.availableStake,
    suspended: delta.suspended
  };
}

function logEventStartAtNormalization(
  source: { collectorId: string; bookmakerId: BookmakerCode; lobbyId: LobbyCode },
  collectedAt: string,
  items: Array<{ eventStartAt?: string }>
) {
  const pairs = new Map<string, number>();
  for (const item of items) {
    const raw = item.eventStartAt?.trim() ?? "";
    if (raw === "") {
      continue;
    }
    const normalized = normalizeSourceEventStartAt(source, raw, collectedAt);
    const key = `${raw}=>${normalized}`;
    pairs.set(key, (pairs.get(key) ?? 0) + 1);
  }

  for (const [key, count] of pairs.entries()) {
    const [raw, normalized] = key.split("=>");
    console.log(
      `[${source.collectorId}-worker] eventStartAt raw="${raw}" normalized="${normalized}" count=${count}`
    );
  }
}
