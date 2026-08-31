import crypto from "node:crypto";
import type {
  AccountBalanceObservation,
  BookmakerCode,
  CollectorHeartbeat,
  CollectorSink,
  FixtureMarketSnapshot,
  LiveBetHandler,
  LiveBetResult,
  LiveCancelPreparedBetRequest,
  LiveCommitBetRequest,
  LivePrepareBetRequest,
  LiveReconcileBetRequest,
  LobbyCode,
  OddsDelta,
  OddsSelection,
  OddsSnapshot,
  QuoteConfirmationHandler,
  QuoteConfirmationRequest,
  SimulatedBetCommand,
  SimulatedPlaceBetHandler,
  SimulatedPlaceBetRequest
} from "../contracts.js";
import { normalizeSourceEventStartAt } from "./source-event-start-at.js";
import { envString } from "../core/env.js";
import { liveBetFeatureFlags } from "../live-actions.js";

type CollectorSourceIdentity = {
  collectorId: string;
  bookmakerId: BookmakerCode;
  lobbyId: LobbyCode;
};

type HelloAckFrame = {
  type?: string;
  protocol_version?: number;
  session_id?: string;
  account_id?: string;
  source?: {
    collector_id?: string;
    bookmaker_id?: string;
    lobby_id?: string;
  };
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

type SimulateBetFrame = {
  type?: string;
  session_id?: string;
  request_id?: string;
  action_id?: string;
  opportunity_id?: string;
  leg_id?: string;
  sequence?: number;
  fixture_id?: string;
  market_id?: string;
  outcome_id?: string;
  expected_odds?: number;
  stake_vnd?: number;
  expires_at?: string;
  timeout_ms?: number;
  idempotency_key?: string;
};

type LiveBetFrame = {
  type?: string;
  protocol_version?: number;
  session_id?: string;
  request_id?: string;
  action_id?: string;
  attempt_id?: string;
  opportunity_id?: string;
  leg_id?: string;
  account_id?: string;
  source?: {
    collector_id?: string;
    bookmaker_id?: string;
    lobby_id?: string;
  };
  fixture_id?: string;
  market_id?: string;
  outcome_id?: string;
  provider_ref?: string;
  expected_odds?: number;
  expected_raw_odds?: number;
  odds_format?: string;
  quote_revision?: string;
  prepare_id?: string;
  idempotency_key?: string;
  stake_vnd?: number;
  expires_at?: string;
};

type PreparedSimulatedSelection = {
  actionId: string;
  opportunityId: string;
  legId: string;
  sequence: 1 | 2;
  fixtureId: string;
  marketId: string;
  outcomeId: string;
  selectedOdds: number;
};

type CachedSimulatedPlacement = {
  fingerprint: string;
  response: Record<string, unknown>;
};

type ParsedSimulatedBetCommand = SimulatedBetCommand & {
  sessionId: string;
};

type ParsedSimulatedPlaceBetRequest = ParsedSimulatedBetCommand & SimulatedPlaceBetRequest;

type LiveBetCorrelationFields = {
  requestId: string;
  actionId: string;
  attemptId: string;
  opportunityId: string;
  legId: string;
};

export class BackendCollectorStreamSink implements CollectorSink {
  private readonly startedAt = new Date().toISOString();
  private readonly streamURL: string;
  private latestBootstrap: OddsSnapshot | null = null;
  private readonly latestSelections = new Map<string, OddsSelection>();
  private readonly latestSelectionObservedAt = new Map<string, string>();
  private readonly preparedSimulatedSelections = new Map<string, PreparedSimulatedSelection>();
  private readonly simulatedPlacementResults = new Map<string, CachedSimulatedPlacement>();
  private socket: WebSocket | null = null;
  private readyPromise: Promise<void> | null = null;
  private readyResolve: (() => void) | null = null;
  private readyReject: ((error: Error) => void) | null = null;
  private sendQueue = Promise.resolve();
  private pendingResync = true;
  private sessionId = "";
  private seq = 0;
  private quoteConfirmationHandler: QuoteConfirmationHandler | null = null;
  private simulatedPlaceBetHandler: SimulatedPlaceBetHandler | null = null;
  private liveBetHandler: LiveBetHandler | null = null;
  private readonly accountId: string;
  private readonly accessToken: string;
  private readonly streamProtocolVersion: 3 | 4;
  private batchCounter = 0;
  private readonly latestFixtureMetadata = new Map<string, OddsSelection>();
  private readonly latestFixtureBatches = new Map<string, { batchId: string; fingerprint: string }>();
  private balanceProtocolWarningEmitted = false;

  constructor(
    backendURL: string,
    private readonly source: CollectorSourceIdentity
  ) {
    this.accountId = collectorAccountID(source);
    this.accessToken = collectorAccessToken(source);
    this.streamProtocolVersion = this.accountId && this.accessToken ? 4 : 3;
    this.streamURL = buildCollectorStreamURL(
      backendURL,
      source,
      this.streamProtocolVersion === 4 ? this.accountId : "",
      this.streamProtocolVersion === 4 ? this.accessToken : "",
    );
  }

  async pushBootstrap(snapshot: OddsSnapshot): Promise<void> {
    this.replaceLatestSnapshot(snapshot);
    await this.enqueue(async () => {
      await this.ensureConnected();
      await this.sendBootstrapSnapshot(snapshot);
      await this.sendFixtureMarketSnapshots(
        new Set(snapshot.selections.map((selection) => selection.fixtureId)),
        snapshot.collectedAt
      );
      this.pendingResync = false;
    });
  }

  async pushDelta(deltas: OddsDelta[]): Promise<void> {
    if (deltas.length === 0) {
      return;
    }

    const fixtureIds = new Set(deltas.map((delta) => delta.fixtureId));
    this.applyLatestDeltas(deltas);
    await this.enqueue(async () => {
      await this.ensureConnected();
      await this.replayLatestBootstrapIfNeeded();

      const upserts: any[] = [];

      for (const delta of deltas) {
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
            provider_ref: delta.providerRef ?? "",
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
      await this.sendFixtureMarketSnapshots(
        fixtureIds,
        latestDeltaObservedAt(deltas)
      );
    });
  }

  async pushFixtureMarketSnapshot(snapshot: FixtureMarketSnapshot): Promise<void> {
    await this.enqueue(async () => {
      await this.ensureConnected();
      await this.sendFixtureMarketSnapshot(snapshot);
    });
  }

  async observeFixtureMarketBatch(fixtureId: string, observedAt: string): Promise<void> {
    await this.observeFixtureMarketBatches([fixtureId], observedAt);
  }

  async observeFixtureMarketBatches(fixtureIds: string[], observedAt: string): Promise<void> {
    const batches = Array.from(new Set(fixtureIds)).flatMap((fixtureId) => {
      const batch = this.latestFixtureBatches.get(fixtureId);
      return batch ? [{ fixtureId, batch }] : [];
    });
    if (batches.length === 0) {
      return;
    }
    await this.enqueue(async () => {
      await this.ensureConnected();
      await this.replayLatestBootstrapIfNeeded();
      const items = batches.flatMap(({ fixtureId, batch }) =>
        this.latestFixtureBatches.get(fixtureId) === batch
          ? [{
              fixture_id: fixtureId,
              batch_id: batch.batchId,
              fingerprint: batch.fingerprint
            }]
          : []
      );
      if (items.length === 0) {
        return;
      }
      await this.sendFrame({
        type: "fixture_observed_batch",
        protocol_version: 2,
        session_id: this.sessionId,
        seq: this.nextSeq(),
        observed_at: observedAt,
        source: serializeSource(this.source),
        items
      });
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

  setSimulatedPlaceBetHandler(handler: SimulatedPlaceBetHandler | null) {
    this.simulatedPlaceBetHandler = handler;
  }

  setLiveBetHandler(handler: LiveBetHandler | null) {
    this.liveBetHandler = handler;
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
    this.preparedSimulatedSelections.clear();
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
        protocol_version: this.streamProtocolVersion,
        session_id: this.sessionId,
        source: {
          collector_id: this.source.collectorId,
          bookmaker_id: this.source.bookmakerId,
          lobby_id: this.source.lobbyId
        },
        account_id: this.streamProtocolVersion === 4 ? this.accountId : undefined,
        capabilities: this.streamProtocolVersion === 4 ? this.liveCapabilities() : undefined,
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
    let parsed: HelloAckFrame | ResyncFrame | ErrorFrame | ConfirmQuoteFrame | SimulateBetFrame | LiveBetFrame;

    try {
      parsed = JSON.parse(payload) as HelloAckFrame | ResyncFrame | ErrorFrame | ConfirmQuoteFrame;
    } catch {
      return;
    }

    if (parsed.type === "hello_ack" && "session_id" in parsed && parsed.session_id === this.sessionId) {
      const ack = parsed as HelloAckFrame;
      if (this.streamProtocolVersion === 4 && (
        ack.protocol_version !== 4 || ack.account_id !== this.accountId ||
        ack.source?.collector_id !== this.source.collectorId ||
        ack.source?.bookmaker_id !== this.source.bookmakerId ||
        ack.source?.lobby_id !== this.source.lobbyId
      )) {
        this.readyReject?.(new Error(
          `collector stream v4 hello_ack identity does not match ` +
          `(account=${ack.account_id ?? "missing"}/${this.accountId}, ` +
          `source=${ack.source?.collector_id ?? "missing"}:${ack.source?.bookmaker_id ?? "missing"}:${ack.source?.lobby_id ?? "missing"}/` +
          `${this.source.collectorId}:${this.source.bookmakerId}:${this.source.lobbyId})`
        ));
        this.socket?.close();
        return;
      }
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
      return;
    }

    if (parsed.type === "simulate_select_odds") {
      void this.handleSimulatedSelectOdds(parsed as SimulateBetFrame);
      return;
    }

    if (parsed.type === "simulate_place_bet") {
      void this.handleSimulatedPlaceBet(parsed as SimulateBetFrame);
      return;
    }

    if (parsed.type === "prepare_bet") {
      void this.handleLivePrepare(parsed as LiveBetFrame);
      return;
    }
    if (parsed.type === "commit_bet") {
      void this.handleLiveCommit(parsed as LiveBetFrame);
      return;
    }
    if (parsed.type === "cancel_prepared_bet") {
      void this.handleLiveCancel(parsed as LiveBetFrame);
      return;
    }
    if (parsed.type === "reconcile_bet") {
      void this.handleLiveReconcile(parsed as LiveBetFrame);
    }
  }

  private liveCapabilities() {
    const capabilities = ["account_balance_v1"];
    const flags = liveBetFeatureFlags();
    if (!flags.enabled) return capabilities;
    capabilities.push("bet_prepare_v1", "bet_reconcile_v1");
    if (flags.commitEnabled) {
      capabilities.push("bet_commit_v1");
    }
    return capabilities;
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

  async pushAccountBalance(balance: AccountBalanceObservation): Promise<void> {
    if (this.streamProtocolVersion !== 4) {
      if (!this.balanceProtocolWarningEmitted) {
        console.warn(
          `[collector-stream] account balance telemetry disabled for ${this.source.collectorId}: ` +
          "collector account credentials are not configured"
        );
        this.balanceProtocolWarningEmitted = true;
      }
      return;
    }
    if (!sameSource(balance.source, this.source)) {
      throw new Error("account balance source does not match collector stream identity");
    }
    if (!Number.isFinite(balance.amount) || balance.amount < 0 ||
      (balance.amountVnd !== undefined &&
        (!Number.isFinite(balance.amountVnd) || balance.amountVnd < 0))) {
      throw new Error("account balance amount must be finite and non-negative");
    }

    await this.enqueue(async () => {
      await this.ensureConnected();
      await this.replayLatestBootstrapIfNeeded();
      await this.sendFrame({
        type: "account_balance",
        protocol_version: 4,
        session_id: this.sessionId,
        seq: this.nextSeq(),
        account_id: this.accountId,
        observed_at: balance.observedAt,
        source: serializeSource(balance.source),
        balance: {
          amount: balance.amount,
          currency: balance.currency,
          amount_vnd: balance.amountVnd,
          display_text: balance.displayText
        }
      });
    });
  }

  private async handleLivePrepare(frame: LiveBetFrame) {
    if (!this.liveFrameTargetsCollector(frame)) return;
    const request = parseLivePrepareBetRequest(frame);
    if (!request) {
      await this.sendInvalidLiveResponse(frame, "bet_prepared", "invalid prepare_bet command");
      return;
    }
    let response: Record<string, unknown>;
    try {
      assertLiveCommandFresh(request.expiresAt);
      if (!this.liveBetHandler) {
        throw new Error("live bet preparation is disabled by this collector");
      }
      const result = await this.liveBetHandler.prepare(request);
      response = result.result === "prepared"
        ? {
            result: result.result,
            observed_at: result.observedAt,
            prepare_id: result.prepareId,
            slip_fingerprint: result.slipFingerprint,
            displayed_odds: result.displayedOdds,
            raw_odds: result.rawOdds,
            odds_format: result.oddsFormat,
            minimum_stake_vnd: result.minimumStakeVnd,
            maximum_stake_vnd: result.maximumStakeVnd,
            stake_increment_vnd: result.stakeIncrementVnd,
            balance_vnd: result.balanceVnd,
            session_generation: result.sessionGeneration,
          }
        : {
            result: result.result,
            observed_at: result.observedAt,
            error: result.error,
          };
    } catch (cause) {
      response = rejectedLivePayload(cause);
    }
    await this.sendLiveResponse("bet_prepared", request, response);
  }

  private async handleLiveCommit(frame: LiveBetFrame) {
    if (!this.liveFrameTargetsCollector(frame)) return;
    const request = parseLiveCommitBetRequest(frame);
    if (!request) {
      await this.sendInvalidLiveResponse(frame, "bet_result", "invalid commit_bet command");
      return;
    }
    let result: LiveBetResult;
    try {
      assertLiveCommandFresh(request.expiresAt);
      if (!this.liveBetHandler) {
        throw new Error("live bet commit is disabled by this collector");
      }
      result = await this.liveBetHandler.commit(request);
    } catch (cause) {
      result = {
        result: "rejected",
        observedAt: new Date().toISOString(),
        error: errorMessage(cause),
      };
    }
    await this.sendLiveResponse("bet_result", request, serializeLiveBetResult(result), {
      prepare_id: request.prepareId,
      idempotency_key: request.idempotencyKey,
    });
  }

  private async handleLiveCancel(frame: LiveBetFrame) {
    if (!this.liveFrameTargetsCollector(frame)) return;
    const request = parseLiveCancelPreparedBetRequest(frame);
    if (!request) {
      await this.sendInvalidLiveResponse(frame, "bet_cancelled", "invalid cancel_prepared_bet command");
      return;
    }
    let response: Record<string, unknown>;
    try {
      assertLiveCommandFresh(request.expiresAt);
      if (!this.liveBetHandler) {
        throw new Error("live bet cancellation is disabled by this collector");
      }
      const result = await this.liveBetHandler.cancel(request);
      response = {
        result: result.result,
        observed_at: result.observedAt,
        error: result.error,
      };
    } catch (cause) {
      response = rejectedLivePayload(cause);
    }
    await this.sendLiveResponse("bet_cancelled", request, response, {
      prepare_id: request.prepareId,
    });
  }

  private async handleLiveReconcile(frame: LiveBetFrame) {
    if (!this.liveFrameTargetsCollector(frame)) return;
    const request = parseLiveReconcileBetRequest(frame);
    if (!request) {
      await this.sendInvalidLiveResponse(frame, "bet_reconciled", "invalid reconcile_bet command");
      return;
    }
    let result: LiveBetResult;
    try {
      assertLiveCommandFresh(request.expiresAt);
      if (!this.liveBetHandler) {
        throw new Error("live bet reconciliation is disabled by this collector");
      }
      result = await this.liveBetHandler.reconcile(request);
    } catch (cause) {
      result = {
        result: "rejected",
        observedAt: new Date().toISOString(),
        error: errorMessage(cause),
      };
    }
    await this.sendLiveResponse("bet_reconciled", request, serializeLiveBetResult(result), {
      idempotency_key: request.idempotencyKey,
    });
  }

  private liveFrameTargetsCollector(frame: LiveBetFrame) {
    return this.streamProtocolVersion === 4 &&
      frame.protocol_version === 4 &&
      frame.session_id === this.sessionId &&
      frame.account_id === this.accountId &&
      frame.source?.collector_id === this.source.collectorId &&
      frame.source?.bookmaker_id === this.source.bookmakerId &&
      frame.source?.lobby_id === this.source.lobbyId;
  }

  private async sendInvalidLiveResponse(
    frame: LiveBetFrame,
    responseType: "bet_prepared" | "bet_result" | "bet_cancelled" | "bet_reconciled",
    error: string,
  ) {
    if (!this.liveFrameTargetsCollector(frame)) return;
    const correlation = parseLiveCorrelation(frame);
    if (!correlation) return;
    await this.sendLiveResponse(responseType, correlation, {
      result: "rejected",
      observed_at: new Date().toISOString(),
      error,
    }, {
      prepare_id: cleanLiveString(frame.prepare_id),
      idempotency_key: cleanLiveString(frame.idempotency_key),
    });
  }

  private async sendLiveResponse(
    responseType: "bet_prepared" | "bet_result" | "bet_cancelled" | "bet_reconciled",
    request: LiveBetCorrelationFields,
    response: Record<string, unknown>,
    extra: Record<string, unknown> = {},
  ) {
    await this.enqueue(async () => {
      await this.ensureConnected();
      await this.sendFrame({
        type: responseType,
        protocol_version: 4,
        session_id: this.sessionId,
        seq: this.nextSeq(),
        request_id: request.requestId,
        action_id: request.actionId,
        attempt_id: request.attemptId,
        opportunity_id: request.opportunityId,
        leg_id: request.legId,
        account_id: this.accountId,
        source: serializeSource(this.source),
        ...extra,
        ...response,
      });
    });
  }

  private async handleSimulatedSelectOdds(frame: SimulateBetFrame) {
    const request = parseSimulatedBetCommand(frame);
    if (!request) {
      await this.sendInvalidSimulatedResponse(frame, "simulate_select_odds_response", "invalid simulated select command");
      return;
    }
    if (request.sessionId !== this.sessionId) return;

    if (simulationCommandExpired(request.expiresAt)) {
      await this.sendSimulatedResponse(request, "simulate_select_odds_response", {
        result: "failed",
        observed_at: new Date().toISOString(),
        error: "simulated select command has expired",
      });
      return;
    }

    const cacheKey = selectionCacheKey(
      request.fixtureId,
      request.marketId,
      request.outcomeId,
    );
    const selection = this.latestSelections.get(cacheKey);
    const selectionObservedAt = this.latestSelectionObservedAt.get(cacheKey) ?? "";
    const selected = selection && !selection.suspended &&
      freshSimulationSelection(selectionObservedAt, request.timeoutMs)
      ? selection
      : null;
    if (selected) {
      setBoundedMap(this.preparedSimulatedSelections, simulatedLegKey(request), {
        actionId: request.actionId,
        opportunityId: request.opportunityId,
        legId: request.legId,
        sequence: request.sequence,
        fixtureId: request.fixtureId,
        marketId: request.marketId,
        outcomeId: request.outcomeId,
        selectedOdds: selected.odds,
      });
    }
    await this.sendSimulatedResponse(request, "simulate_select_odds_response", {
      result: selected ? "selected" : "unavailable",
      observed_at: selected ? selectionObservedAt : new Date().toISOString(),
      expected_odds: request.expectedOdds,
      selected_odds: selected?.odds,
      selection: selected ? serializeConfirmedSelection(selected) : undefined,
      error: selected ? undefined : "selection is missing, suspended, or stale",
    });
  }

  private async handleSimulatedPlaceBet(frame: SimulateBetFrame) {
    const request = parseSimulatedPlaceBetRequest(frame);
    if (!request) {
      await this.sendInvalidSimulatedResponse(frame, "simulate_place_bet_response", "invalid simulated placement command");
      return;
    }
    if (request.sessionId !== this.sessionId) return;

    let response: Record<string, unknown>;
    try {
      const fingerprint = simulatedPlacementFingerprint(request);
      const cached = this.simulatedPlacementResults.get(request.idempotencyKey);
      if (cached) {
        if (cached.fingerprint !== fingerprint) {
          throw new Error("idempotency key was reused with a different simulated bet payload");
        }
        await this.sendSimulatedResponse(request, "simulate_place_bet_response", cached.response);
        return;
      }
      if (simulationCommandExpired(request.expiresAt)) {
        throw new Error("simulated placement command has expired");
      }
      const prepared = this.preparedSimulatedSelections.get(simulatedLegKey(request));
      if (!prepared || !samePreparedSelection(prepared, request)) {
        response = {
          result: "rejected",
          observed_at: new Date().toISOString(),
          error: "simulated placement requires a matching select-odds phase",
        };
        await this.sendSimulatedResponse(request, "simulate_place_bet_response", response);
        return;
      }

      const cacheKey = selectionCacheKey(request.fixtureId, request.marketId, request.outcomeId);
      const current = this.latestSelections.get(cacheKey);
      const currentObservedAt = this.latestSelectionObservedAt.get(cacheKey) ?? "";
      if (!current || current.suspended ||
        !freshSimulationSelection(currentObservedAt, request.timeoutMs)) {
        response = {
          result: "rejected",
          observed_at: new Date().toISOString(),
          error: "prepared simulated selection is no longer available",
        };
        await this.sendSimulatedResponse(request, "simulate_place_bet_response", response);
        return;
      }
      if (Math.abs(current.odds - request.expectedOdds) > 0.001) {
        response = {
          result: "odds_changed",
          observed_at: currentObservedAt,
          submitted_odds: request.expectedOdds,
          offered_odds: current.odds,
          confirmation_required: true,
        };
        setBoundedMap(this.simulatedPlacementResults, request.idempotencyKey, {
          fingerprint,
          response,
        });
        this.preparedSimulatedSelections.delete(simulatedLegKey(request));
        await this.sendSimulatedResponse(request, "simulate_place_bet_response", response);
        return;
      }
      if (!this.simulatedPlaceBetHandler) {
        throw new Error("simulated placement is not configured by this collector");
      }
      const result = await this.simulatedPlaceBetHandler(request);
      response = result.result === "ticket_accepted"
        ? {
            result: result.result,
            observed_at: result.observedAt,
            ticket_id: result.ticketId,
            accepted_odds: result.acceptedOdds,
            stake_vnd: result.stakeVnd,
          }
        : {
            result: result.result,
            observed_at: result.observedAt,
            submitted_odds: result.submittedOdds,
            offered_odds: result.offeredOdds,
            confirmation_required: result.confirmationRequired,
          };
      setBoundedMap(this.simulatedPlacementResults, request.idempotencyKey, {
        fingerprint,
        response,
      });
      this.preparedSimulatedSelections.delete(simulatedLegKey(request));
    } catch (cause) {
      response = {
        result: "failed",
        observed_at: new Date().toISOString(),
        error: cause instanceof Error ? cause.message : String(cause),
      };
    }

    await this.sendSimulatedResponse(request, "simulate_place_bet_response", response);
  }

  private async sendInvalidSimulatedResponse(
    frame: SimulateBetFrame,
    responseType: "simulate_select_odds_response" | "simulate_place_bet_response",
    error: string,
  ) {
    const requestId = typeof frame.request_id === "string" ? frame.request_id.trim() : "";
    const actionId = typeof frame.action_id === "string" ? frame.action_id.trim() : "";
    if (!requestId || !actionId || frame.session_id !== this.sessionId) return;
    await this.enqueue(async () => {
      await this.ensureConnected();
      await this.sendFrame({
        type: responseType,
        session_id: this.sessionId,
        seq: this.nextSeq(),
        request_id: requestId,
        action_id: actionId,
        opportunity_id: typeof frame.opportunity_id === "string" ? frame.opportunity_id.trim() : "",
        leg_id: typeof frame.leg_id === "string" ? frame.leg_id.trim() : "",
        sequence: typeof frame.sequence === "number" ? frame.sequence : 0,
        idempotency_key: typeof frame.idempotency_key === "string" ? frame.idempotency_key.trim() : undefined,
        result: "failed",
        observed_at: new Date().toISOString(),
        error,
      });
    });
  }

  private async sendSimulatedResponse(
    request: ParsedSimulatedBetCommand,
    responseType: "simulate_select_odds_response" | "simulate_place_bet_response",
    response: Record<string, unknown>,
  ) {
    await this.enqueue(async () => {
      await this.ensureConnected();
      await this.sendFrame({
        type: responseType,
        session_id: this.sessionId,
        seq: this.nextSeq(),
        request_id: request.requestId,
        action_id: request.actionId,
        opportunity_id: request.opportunityId,
        leg_id: request.legId,
        sequence: request.sequence,
        idempotency_key: "idempotencyKey" in request ? request.idempotencyKey : undefined,
        ...response,
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
    await this.sendFixtureMarketSnapshots(
      new Set(this.latestFixtureMetadata.keys()),
      this.latestBootstrap.collectedAt
    );
    this.pendingResync = false;
  }

  private replaceLatestSnapshot(snapshot: OddsSnapshot) {
    this.latestBootstrap = {
      ...snapshot,
      selections: []
    };
    this.latestSelections.clear();
    this.latestSelectionObservedAt.clear();
    this.latestFixtureMetadata.clear();
    for (const selection of snapshot.selections) {
      this.latestSelections.set(selectionCacheKey(
        selection.fixtureId,
        selection.marketId,
        selection.outcomeId,
      ), selection);
      this.latestSelectionObservedAt.set(selectionCacheKey(
        selection.fixtureId,
        selection.marketId,
        selection.outcomeId,
      ), snapshot.collectedAt);
      this.latestFixtureMetadata.set(selection.fixtureId, selection);
    }
  }

  private applyLatestDeltas(deltas: OddsDelta[]) {
    if (!this.latestBootstrap) {
      return;
    }

    let collectedAt = this.latestBootstrap.collectedAt;
    let collectedAtMs = Date.parse(collectedAt);
    for (const delta of deltas) {
      this.latestFixtureMetadata.set(delta.fixtureId, selectionFromDelta(delta));
      if (delta.op === "remove") {
        this.latestSelections.delete(selectionCacheKey(
          delta.fixtureId,
          delta.marketId,
          delta.outcomeId,
        ));
        this.latestSelectionObservedAt.delete(selectionCacheKey(
          delta.fixtureId,
          delta.marketId,
          delta.outcomeId,
        ));
      } else {
        this.latestSelections.set(selectionCacheKey(
          delta.fixtureId,
          delta.marketId,
          delta.outcomeId,
        ), selectionFromDelta(delta));
        this.latestSelectionObservedAt.set(selectionCacheKey(
          delta.fixtureId,
          delta.marketId,
          delta.outcomeId,
        ), delta.collectedAt);
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

  private async sendFixtureMarketSnapshots(
    fixtureIds: Set<string>,
    observedAt: string
  ) {
    for (const fixtureId of fixtureIds) {
      const selections = Array.from(this.latestSelections.values()).filter(
        (selection) => selection.fixtureId === fixtureId && isDetectorMarket(selection.marketId)
      );
      const metadata = selections[0] ?? this.latestFixtureMetadata.get(fixtureId);
      if (!metadata) {
        continue;
      }
      await this.sendFixtureMarketSnapshot(
        fixtureMarketSnapshotFromSelections(
          this.source,
          metadata,
          selections,
          observedAt
        )
      );
    }
  }

  private async sendFixtureMarketSnapshot(snapshot: FixtureMarketSnapshot) {
    const batchId = `${this.sessionId}:${++this.batchCounter}`;
    const fingerprint = fixtureMarketFingerprint(snapshot);
    await this.sendFrame({
      type: "fixture_market_snapshot",
      protocol_version: 2,
      session_id: this.sessionId,
      seq: this.nextSeq(),
      batch_id: batchId,
      fingerprint,
      source_event_id: snapshot.sourceEventId ?? "",
      observed_at: snapshot.observedAt,
      source: serializeSource(snapshot.source),
      fixture: {
        fixture_id: snapshot.fixtureId,
        sport: snapshot.sport ?? "football",
        home_team: snapshot.homeTeam ?? "",
        away_team: snapshot.awayTeam ?? "",
        league_name: snapshot.leagueName ?? "",
        match_state: snapshot.matchState ?? "unknown",
        event_start_at: normalizeSourceEventStartAt(
          snapshot.source,
          snapshot.eventStartAt,
          snapshot.observedAt
        )
      },
      complete: snapshot.complete,
      markets: snapshot.markets.map((market) => ({
        market_id: market.marketId,
        period: market.period,
        normalized_line: market.normalizedLine,
        status: market.status,
        outcomes: market.outcomes.map((outcome) => ({
          outcome_id: outcome.outcomeId,
          outcome_name: outcome.outcomeName,
          side: outcome.side,
          odds: outcome.odds,
          raw_odds: outcome.rawOdds ?? 0,
          odds_format: outcome.oddsFormat ?? "",
          provider_ref: outcome.providerRef ?? "",
          available_stake: outcome.availableStake,
          suspended: outcome.suspended
        }))
      }))
    });
    this.latestFixtureBatches.set(snapshot.fixtureId, { batchId, fingerprint });
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
        outcome_id: selection.outcomeId,
        provider_ref: selection.providerRef ?? ""
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
        provider_ref: selection.providerRef ?? "",
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

function parseLiveCorrelation(frame: LiveBetFrame): LiveBetCorrelationFields | null {
  const requestId = cleanLiveString(frame.request_id);
  const actionId = cleanLiveString(frame.action_id);
  const attemptId = cleanLiveString(frame.attempt_id);
  const opportunityId = cleanLiveString(frame.opportunity_id);
  const legId = cleanLiveString(frame.leg_id);
  if (!requestId || !actionId || !attemptId || !opportunityId || !legId) return null;
  return { requestId, actionId, attemptId, opportunityId, legId };
}

function parseLivePrepareBetRequest(frame: LiveBetFrame): LivePrepareBetRequest | null {
  const correlation = parseLiveCorrelation(frame);
  const fixtureId = cleanLiveString(frame.fixture_id);
  const marketId = cleanLiveString(frame.market_id);
  const outcomeId = cleanLiveString(frame.outcome_id);
  const providerRef = cleanLiveString(frame.provider_ref, 256);
  const oddsFormat = frame.odds_format === "malay" || frame.odds_format === "indonesian"
    ? frame.odds_format
    : null;
  const expectedOdds = frame.expected_odds;
  const expectedRawOdds = frame.expected_raw_odds;
  const expiresAt = cleanLiveString(frame.expires_at);
  if (!correlation || !fixtureId || !marketId || !outcomeId || !providerRef ||
    /^(?:javascript|data):/i.test(providerRef) || !oddsFormat ||
    !validCanonicalOdds(expectedOdds) ||
    (expectedRawOdds !== undefined && (!Number.isFinite(expectedRawOdds) || expectedRawOdds === 0)) ||
    !validFutureTimestamp(expiresAt)) {
    return null;
  }
  return {
    ...correlation,
    fixtureId,
    marketId,
    outcomeId,
    providerRef,
    expectedOdds,
    expectedRawOdds,
    oddsFormat,
    quoteRevision: cleanLiveString(frame.quote_revision, 256) || undefined,
    expiresAt,
  };
}

function parseLiveCommitBetRequest(frame: LiveBetFrame): LiveCommitBetRequest | null {
  const correlation = parseLiveCorrelation(frame);
  const prepareId = cleanLiveString(frame.prepare_id, 256);
  const idempotencyKey = cleanLiveString(frame.idempotency_key, 256);
  const expiresAt = cleanLiveString(frame.expires_at);
  if (!correlation || !prepareId || !idempotencyKey || !validCanonicalOdds(frame.expected_odds) ||
    !Number.isSafeInteger(frame.stake_vnd) || Number(frame.stake_vnd) <= 0 ||
    !validFutureTimestamp(expiresAt)) {
    return null;
  }
  return {
    ...correlation,
    prepareId,
    idempotencyKey,
    stakeVnd: frame.stake_vnd as number,
    expectedOdds: frame.expected_odds as number,
    expiresAt,
  };
}

function parseLiveCancelPreparedBetRequest(frame: LiveBetFrame): LiveCancelPreparedBetRequest | null {
  const correlation = parseLiveCorrelation(frame);
  const prepareId = cleanLiveString(frame.prepare_id, 256);
  const expiresAt = cleanLiveString(frame.expires_at);
  if (!correlation || !prepareId || !validFutureTimestamp(expiresAt)) return null;
  return { ...correlation, prepareId, expiresAt };
}

function parseLiveReconcileBetRequest(frame: LiveBetFrame): LiveReconcileBetRequest | null {
  const correlation = parseLiveCorrelation(frame);
  const idempotencyKey = cleanLiveString(frame.idempotency_key, 256);
  const expiresAt = cleanLiveString(frame.expires_at);
  if (!correlation || !idempotencyKey || !validFutureTimestamp(expiresAt)) return null;
  return { ...correlation, idempotencyKey, expiresAt };
}

function cleanLiveString(value: unknown, maximumLength = 512) {
  const result = typeof value === "string" ? value.trim() : "";
  return result.length <= maximumLength ? result : "";
}

function validCanonicalOdds(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value !== 0 && value >= -1 && value <= 1;
}

function validFutureTimestamp(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp > Date.now();
}

function assertLiveCommandFresh(expiresAt: string) {
  if (!validFutureTimestamp(expiresAt)) throw new Error("live bet command has expired");
}

function rejectedLivePayload(cause: unknown) {
  return {
    result: "rejected",
    observed_at: new Date().toISOString(),
    error: errorMessage(cause),
  };
}

function errorMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}

function serializeLiveBetResult(result: LiveBetResult): Record<string, unknown> {
  if (result.result === "ticket_accepted") {
    return {
      result: result.result,
      observed_at: result.observedAt,
      ticket_id: result.ticketId,
      accepted_odds: result.acceptedOdds,
      stake_vnd: result.stakeVnd,
    };
  }
  if (result.result === "odds_changed") {
    return {
      result: result.result,
      observed_at: result.observedAt,
      submitted_odds: result.submittedOdds,
      offered_odds: result.offeredOdds,
      confirmation_required: true,
    };
  }
  return {
    result: result.result,
    observed_at: result.observedAt,
    error: result.error,
  };
}

function parseSimulatedBetCommand(frame: SimulateBetFrame): ParsedSimulatedBetCommand | null {
  const sessionId = typeof frame.session_id === "string" ? frame.session_id.trim() : "";
  const requestId = typeof frame.request_id === "string" ? frame.request_id.trim() : "";
  const actionId = typeof frame.action_id === "string" ? frame.action_id.trim() : "";
  const opportunityId = typeof frame.opportunity_id === "string" ? frame.opportunity_id.trim() : "";
  const legId = typeof frame.leg_id === "string" ? frame.leg_id.trim() : "";
  const fixtureId = typeof frame.fixture_id === "string" ? frame.fixture_id.trim() : "";
  const marketId = typeof frame.market_id === "string" ? frame.market_id.trim() : "";
  const outcomeId = typeof frame.outcome_id === "string" ? frame.outcome_id.trim() : "";
  const expectedOdds = frame.expected_odds;
  const stakeVnd = frame.stake_vnd;
  const sequence = frame.sequence;
  const expiresAt = typeof frame.expires_at === "string" ? frame.expires_at.trim() : "";
  const timeoutMs = frame.timeout_ms === undefined ? 2_000 : frame.timeout_ms;
  if (!sessionId || !requestId || !actionId || !opportunityId || !legId || !fixtureId ||
    !marketId || !outcomeId || typeof expectedOdds !== "number" ||
    !Number.isFinite(expectedOdds) || expectedOdds === 0 || typeof stakeVnd !== "number" ||
    !Number.isSafeInteger(stakeVnd) || stakeVnd <= 0 || typeof sequence !== "number" ||
    (sequence !== 1 && sequence !== 2) || !Number.isFinite(Date.parse(expiresAt)) ||
    typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs)) {
    return null;
  }
  return {
    sessionId,
    requestId,
    actionId,
    opportunityId,
    legId,
    sequence: sequence as 1 | 2,
    fixtureId,
    marketId,
    outcomeId,
    expectedOdds,
    stakeVnd,
    expiresAt,
    timeoutMs: Math.max(Math.min(timeoutMs || 2_000, 3_000), 250),
  };
}

function parseSimulatedPlaceBetRequest(frame: SimulateBetFrame): ParsedSimulatedPlaceBetRequest | null {
  const command = parseSimulatedBetCommand(frame);
  const idempotencyKey = typeof frame.idempotency_key === "string"
    ? frame.idempotency_key.trim()
    : "";
  if (!command || !idempotencyKey) return null;
  return { ...command, idempotencyKey };
}

function selectionCacheKey(fixtureId: string, marketId: string, outcomeId: string) {
  return `${fixtureId}\u0000${marketId}\u0000${outcomeId}`;
}

function simulatedLegKey(request: {
  actionId: string;
  legId: string;
}) {
  return `${request.actionId}\u0000${request.legId}`;
}

function samePreparedSelection(
  prepared: PreparedSimulatedSelection,
  request: ParsedSimulatedBetCommand,
) {
  return prepared.actionId === request.actionId &&
    prepared.opportunityId === request.opportunityId &&
    prepared.legId === request.legId &&
    prepared.sequence === request.sequence &&
    prepared.fixtureId === request.fixtureId &&
    prepared.marketId === request.marketId &&
    prepared.outcomeId === request.outcomeId &&
    Math.abs(prepared.selectedOdds - request.expectedOdds) <= 0.001;
}

function simulationCommandExpired(expiresAt: string) {
  return Date.parse(expiresAt) <= Date.now();
}

function freshSimulationSelection(observedAt: string, maxAgeMs: number) {
  const observedAtMs = Date.parse(observedAt);
  if (!Number.isFinite(observedAtMs)) return false;
  const ageMs = Date.now() - observedAtMs;
  return ageMs >= -1_000 && ageMs <= maxAgeMs;
}

function simulatedPlacementFingerprint(
  request: SimulatedPlaceBetRequest,
) {
  return JSON.stringify({
    actionId: request.actionId,
    opportunityId: request.opportunityId,
    legId: request.legId,
    sequence: request.sequence,
    fixtureId: request.fixtureId,
    marketId: request.marketId,
    outcomeId: request.outcomeId,
    expectedOdds: request.expectedOdds,
    stakeVnd: request.stakeVnd,
  });
}

function setBoundedMap<K, V>(target: Map<K, V>, key: K, value: V) {
  if (!target.has(key) && target.size >= 10_000) {
    const oldest = target.keys().next().value as K | undefined;
    if (oldest !== undefined) target.delete(oldest);
  }
  target.set(key, value);
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
    odds_format: selection.oddsFormat ?? "",
    provider_ref: selection.providerRef ?? ""
  };
}

function buildCollectorStreamURL(
  backendURL: string,
  source: CollectorSourceIdentity,
  accountId: string,
  accessToken: string,
) {
  const target = new URL(backendURL);
  target.protocol = target.protocol === "https:" ? "wss:" : "ws:";
  target.pathname = "/v2/collector/stream";
  target.search = "";
  if (accountId && accessToken) {
    target.searchParams.set("collector_id", source.collectorId);
    target.searchParams.set("bookmaker_id", source.bookmakerId);
    target.searchParams.set("lobby_id", source.lobbyId);
    target.searchParams.set("account_id", accountId);
    target.searchParams.set("access_token", accessToken);
  }
  target.hash = "";
  return target.toString();
}

function collectorAccountID(source: CollectorSourceIdentity) {
  return collectorEnvValue(source, "COLLECTOR_ACCOUNT_ID");
}

function collectorAccessToken(source: CollectorSourceIdentity) {
  return collectorEnvValue(source, "COLLECTOR_STREAM_TOKEN");
}

function collectorEnvValue(source: CollectorSourceIdentity, suffix: string) {
  const prefix = `${source.bookmakerId}_${source.lobbyId}`
    .replace(/[^a-z0-9]+/gi, "_")
    .toUpperCase();
  return envString(`${prefix}_${suffix}`, envString(suffix, "")).trim();
}

function serializeSource(source: CollectorSourceIdentity | OddsSnapshot["source"] | OddsDelta["source"]) {
  return {
    collector_id: source.collectorId,
    bookmaker_id: source.bookmakerId,
    lobby_id: source.lobbyId
  };
}

function sameSource(
  left: CollectorSourceIdentity | OddsSnapshot["source"],
  right: CollectorSourceIdentity
) {
  return left.collectorId === right.collectorId &&
    left.bookmakerId === right.bookmakerId &&
    left.lobbyId === right.lobbyId;
}

function serializeRawIDs(delta: OddsDelta) {
  return {
    fixture_id: delta.fixtureId,
    market_id: delta.marketId,
    outcome_id: delta.outcomeId,
    provider_ref: delta.providerRef ?? ""
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
    suspended: delta.suspended,
    sourceEventId: delta.sourceEventId,
    rawOdds: delta.rawOdds,
    oddsFormat: delta.oddsFormat,
    providerRef: delta.providerRef
  };
}

function fixtureMarketSnapshotFromSelections(
  source: CollectorSourceIdentity,
  metadata: OddsSelection,
  selections: OddsSelection[],
  observedAt: string
): FixtureMarketSnapshot {
  const markets = new Map<string, FixtureMarketSnapshot["markets"][number]>();
  for (const selection of selections) {
    const side = selectionSide(selection, metadata.homeTeam ?? "", metadata.awayTeam ?? "");
    const rawLine = outcomeLine(selection.outcomeName);
    if (!side || rawLine === "") {
      continue;
    }
    const normalizedLine = normalizeAsianLine(rawLine);
    const key = `${selection.marketId}\u0000${normalizedLine}`;
    const market = markets.get(key) ?? {
      marketId: selection.marketId,
      period: isFirstHalfMarket(selection.marketId) ? "1H" : "FT",
      normalizedLine,
      status: "suspended" as const,
      outcomes: []
    };
    market.outcomes.push({
      outcomeId: selection.outcomeId,
      outcomeName: selection.outcomeName,
      side,
      odds: selection.odds,
      rawOdds: selection.rawOdds,
      oddsFormat: selection.oddsFormat,
      providerRef: selection.providerRef,
      availableStake: selection.availableStake,
      suspended: selection.suspended
    });
    markets.set(key, market);
  }

  for (const [key, market] of markets) {
    const expected: Array<"home" | "away" | "over" | "under"> = market.marketId.startsWith("o-u-ou")
      ? ["over", "under"]
      : ["home", "away"];
    const actual = new Set(market.outcomes.map((outcome) => outcome.side));
    if (market.outcomes.length !== 2 || actual.size !== 2 ||
      !expected.every((side) => actual.has(side)) ||
      market.outcomes.some((outcome) => !Number.isFinite(outcome.odds) || outcome.odds === 0)) {
      // Omitting the incomplete market gives the replace snapshot explicit
      // removal semantics, so the backend suspends both previously active legs.
      markets.delete(key);
      continue;
    }
    market.status = market.outcomes.every((outcome) => !outcome.suspended && outcome.odds !== 0)
      ? "open"
      : "suspended";
  }

  return {
    source: {
      collectorId: source.collectorId,
      bookmakerId: source.bookmakerId,
      lobbyId: source.lobbyId
    },
    fixtureId: metadata.fixtureId,
    sport: metadata.sport,
    homeTeam: metadata.homeTeam,
    awayTeam: metadata.awayTeam,
    leagueName: metadata.leagueName,
    matchState: metadata.matchState,
    eventStartAt: metadata.eventStartAt,
    sourceEventId: latestSourceEventID(selections) || metadata.sourceEventId,
    observedAt,
    complete: true,
    markets: Array.from(markets.values())
  };
}

function isDetectorMarket(marketId: string) {
  return /^(?:hdp-ah|hdp-ah-1st|o-u-ou|o-u-ou-1st)$/i.test(marketId.trim());
}

function isFirstHalfMarket(marketId: string) {
  return /(?:1st|1h|first)/i.test(marketId);
}

function selectionSide(
  selection: OddsSelection,
  homeTeam: string,
  awayTeam: string
): "home" | "away" | "over" | "under" | null {
  const name = canonicalText(selection.outcomeName);
  if (selection.marketId.startsWith("o-u-ou")) {
    if (name.startsWith("over ") || name === "over") return "over";
    if (name.startsWith("under ") || name === "under") return "under";
    return null;
  }
  const home = canonicalText(homeTeam);
  const away = canonicalText(awayTeam);
  const participants: Array<{ name: string; side: "home" | "away" }> = [
    { name: home, side: "home" },
    { name: away, side: "away" }
  ];
  return participants
    .filter((participant) => participant.name &&
      (name === participant.name || name.startsWith(`${participant.name} `)))
    .sort((left, right) => right.name.length - left.name.length)[0]?.side ?? null;
}

function outcomeLine(outcomeName: string) {
  return outcomeName.match(/([+-]?\d+(?:\.\d+)?(?:\/[+-]?\d+(?:\.\d+)?)?)\s*$/)?.[1] ?? "";
}

function normalizeAsianLine(rawLine: string) {
  const raw = rawLine.trim();
  const sign = raw.startsWith("-") ? -1 : raw.startsWith("+") ? 1 : 0;
  const values = raw.split("/").map((part, index) => {
    const value = Number(part);
    if (!Number.isFinite(value)) return Number.NaN;
    if (index > 0 && sign !== 0 && !/^[+-]/.test(part)) return Math.abs(value) * sign;
    return value;
  });
  if (values.some((value) => !Number.isFinite(value))) return raw.replace(/^[+-]/, "");
  const average = Math.abs(values.reduce((sum, value) => sum + value, 0) / values.length);
  if (average < Number.EPSILON) return "0";
  return average.toFixed(2).replace(/\.?0+$/, "");
}

function latestSourceEventID(selections: OddsSelection[]) {
  for (let index = selections.length - 1; index >= 0; index -= 1) {
    if (selections[index].sourceEventId) return selections[index].sourceEventId;
  }
  return "";
}

function latestDeltaObservedAt(deltas: OddsDelta[]) {
  return deltas.reduce((latest, delta) =>
    Date.parse(delta.collectedAt) > Date.parse(latest) ? delta.collectedAt : latest,
  deltas[0]?.collectedAt ?? new Date().toISOString());
}

function fixtureMarketFingerprint(snapshot: FixtureMarketSnapshot) {
  const canonical = snapshot.markets
    .map((market) => ({
      marketId: market.marketId,
      period: market.period,
      line: market.normalizedLine,
      status: market.status,
      outcomes: market.outcomes
        .map((outcome) => ({
          outcomeId: outcome.outcomeId,
          side: outcome.side,
          odds: outcome.odds,
          rawOdds: outcome.rawOdds ?? 0,
          oddsFormat: outcome.oddsFormat ?? "",
          providerRef: outcome.providerRef ?? "",
          suspended: outcome.suspended
        }))
        .sort((left, right) => left.side.localeCompare(right.side))
    }))
    .sort((left, right) =>
      `${left.marketId}\u0000${left.period}\u0000${left.line}`.localeCompare(
        `${right.marketId}\u0000${right.period}\u0000${right.line}`
      )
    );
  return crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
