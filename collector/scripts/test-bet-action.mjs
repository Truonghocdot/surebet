import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import { WebSocketServer } from "ws";

const windows = process.platform === "win32";
const pnpmCommand = windows ? (process.env.ComSpec || "cmd.exe") : "pnpm";
const pnpmArgs = windows
  ? ["/d", "/s", "/c", "pnpm.cmd --filter @surebet/collector-shared run build"]
  : ["--filter", "@surebet/collector-shared", "run", "build"];
const build = spawnSync(
  pnpmCommand,
  pnpmArgs,
  { cwd: new URL("..", import.meta.url), stdio: "inherit", shell: false },
);
if (build.error) {
  throw build.error;
}
if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

const {
  BackendCollectorStreamSink,
  createSimulatedPlaceBetHandler,
  parseLocalizedAccountBalance,
} = await import("../shared/dist/index.js");

assert.equal(parseLocalizedAccountBalance("0.00"), 0);
assert.equal(parseLocalizedAccountBalance("1,234.50"), 1234.5);
assert.equal(parseLocalizedAccountBalance("1.234,50"), 1234.5);
assert.equal(parseLocalizedAccountBalance("not available"), null);

const request = {
  requestId: "request-1",
  actionId: "action-1",
  opportunityId: "opportunity-1",
  legId: "jun88-leg",
  sequence: 1,
  fixtureId: "fixture-1",
  marketId: "market-1",
  outcomeId: "outcome-1",
  expectedOdds: -0.91,
  stakeVnd: 100_000,
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  timeoutMs: 2_000,
  idempotencyKey: "action-1:jun88:place",
};

const acceptedHandler = createSimulatedPlaceBetHandler("jun88", {
  outcome: "ticket_accepted",
});
const accepted = await acceptedHandler(request);
assert.equal(accepted.result, "ticket_accepted");
assert.equal(accepted.acceptedOdds, -0.91);
assert.match(accepted.ticketId, /^SIM-J88-/);
assert.deepEqual(await acceptedHandler({ ...request, requestId: "retry" }), accepted);
await assert.rejects(
  acceptedHandler({ ...request, requestId: "conflict", stakeVnd: 99_999 }),
  /idempotency key was reused/,
);

const changed = await createSimulatedPlaceBetHandler("8xbet", {
  outcome: "odds_changed",
  offeredOdds: -0.86,
})({
  ...request,
  legId: "8xbet-leg",
  sequence: 2,
  idempotencyKey: "action-1:8xbet:place",
});
assert.deepEqual(changed, {
  result: "odds_changed",
  observedAt: changed.observedAt,
  submittedOdds: -0.91,
  offeredOdds: -0.86,
  confirmationRequired: true,
});

const authKeys = [
  "COLLECTOR_ACCOUNT_ID",
  "COLLECTOR_STREAM_TOKEN",
  "8XBET_DEFAULT_COLLECTOR_ACCOUNT_ID",
  "8XBET_DEFAULT_COLLECTOR_STREAM_TOKEN",
  "JUN88_CMD_COLLECTOR_ACCOUNT_ID",
  "JUN88_CMD_COLLECTOR_STREAM_TOKEN",
];
const inheritedAuth = new Map(authKeys.map((key) => [key, process.env[key]]));
for (const key of authKeys) process.env[key] = "";
try {
  await verifyTwoPhaseCollectorSimulation();
  await verifyLiveProtocolV4();
} finally {
  for (const [key, value] of inheritedAuth) restoreEnv(key, value);
}

console.log("simulated bet action checks passed");

async function verifyTwoPhaseCollectorSimulation() {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(server, "listening");
  const address = server.address();
  assert.equal(typeof address, "object");

  const frames = [];
  const waiters = [];
  let socket;
  let sessionId = "";
  server.on("connection", (connected) => {
    socket = connected;
    connected.on("message", (payload) => {
      const frame = JSON.parse(String(payload));
      if (frame.type === "hello") {
        sessionId = frame.session_id;
        connected.send(JSON.stringify({ type: "hello_ack", session_id: sessionId }));
      }
      frames.push(frame);
      for (const waiter of [...waiters]) {
        if (waiter.predicate(frame)) {
          waiters.splice(waiters.indexOf(waiter), 1);
          waiter.resolve(frame);
        }
      }
    });
  });

  const sink = new BackendCollectorStreamSink(
    `http://127.0.0.1:${address.port}`,
    { collectorId: "jun88-cmd", bookmakerId: "jun88", lobbyId: "cmd" },
  );
  sink.setSimulatedPlaceBetHandler(createSimulatedPlaceBetHandler("jun88", {
    outcome: "ticket_accepted",
  }));
  await sink.pushBootstrap({
    source: { collectorId: "jun88-cmd", bookmakerId: "jun88", lobbyId: "cmd" },
    collectedAt: new Date(Date.now() - 5_000).toISOString(),
    selections: [simulationSelection(-0.92)],
  });
  assert.ok(socket);

  socket.send(JSON.stringify(simulationCommand({
    type: "simulate_place_bet",
    requestId: "place-before-select",
    sessionId,
    idempotencyKey: "action-before:jun88:place",
  })));
  const rejected = await waitForFrame(
    frames,
    waiters,
    (frame) => frame.request_id === "place-before-select",
  );
  assert.equal(rejected.result, "rejected");

  socket.send(JSON.stringify(simulationCommand({
    type: "simulate_select_odds",
    requestId: "select-stale",
    sessionId,
  })));
  const stale = await waitForFrame(frames, waiters, (frame) => frame.request_id === "select-stale");
  assert.equal(stale.result, "unavailable");

  const refreshedAt = new Date().toISOString();
  await sink.pushDelta([{
    ...simulationSelection(-0.92),
    source: { collectorId: "jun88-cmd", bookmakerId: "jun88", lobbyId: "cmd" },
    collectedAt: refreshedAt,
    op: "upsert",
  }]);
  socket.send(JSON.stringify(simulationCommand({
    type: "simulate_select_odds",
    requestId: "select-1",
    sessionId,
  })));
  const selected = await waitForFrame(frames, waiters, (frame) => frame.request_id === "select-1");
  assert.equal(selected.result, "selected");
  assert.equal(selected.selection.odds, -0.92);
  assert.equal(selected.selection.provider_ref, "fixture-1|ou|ov|0");
  assert.equal(selected.observed_at, refreshedAt);
  assert.equal(selected.leg_id, "jun88-leg");

  await sink.pushDelta([{
    ...simulationSelection(-0.86),
    source: { collectorId: "jun88-cmd", bookmakerId: "jun88", lobbyId: "cmd" },
    collectedAt: new Date().toISOString(),
    op: "upsert",
  }]);
  socket.send(JSON.stringify(simulationCommand({
    type: "simulate_place_bet",
    requestId: "place-repriced",
    sessionId,
    idempotencyKey: "action-1:jun88:place",
  })));
  const repriced = await waitForFrame(
    frames,
    waiters,
    (frame) => frame.request_id === "place-repriced",
  );
  assert.equal(repriced.result, "odds_changed");
  assert.equal(repriced.submitted_odds, -0.92);
  assert.equal(repriced.offered_odds, -0.86);

  socket.terminate();
  await new Promise((resolve) => server.close(resolve));
}

async function verifyLiveProtocolV4() {
  const previous = {
    account: process.env.COLLECTOR_ACCOUNT_ID,
    token: process.env.COLLECTOR_STREAM_TOKEN,
    mode: process.env.AUTO_BET_MODE,
  };
  process.env.COLLECTOR_ACCOUNT_ID = "account-test";
  process.env.COLLECTOR_STREAM_TOKEN = "token-test";
  process.env.AUTO_BET_MODE = "live";

  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(server, "listening");
  const address = server.address();
  assert.equal(typeof address, "object");
  const frames = [];
  const waiters = [];
  let socket;
  let connectionURL = "";
  let sessionId = "";
  server.on("connection", (connected, request) => {
    connectionURL = request.url || "";
    socket = connected;
    connected.on("message", (payload) => {
      const frame = JSON.parse(String(payload));
      frames.push(frame);
      if (frame.type === "hello") {
        sessionId = frame.session_id;
        connected.send(JSON.stringify({
          type: "hello_ack",
          protocol_version: 4,
          session_id: sessionId,
          account_id: frame.account_id,
          source: frame.source,
          capabilities: frame.capabilities,
        }));
      }
      for (const waiter of [...waiters]) {
        if (waiter.predicate(frame)) {
          waiters.splice(waiters.indexOf(waiter), 1);
          waiter.resolve(frame);
        }
      }
    });
  });

  try {
    const source = { collectorId: "jun88-cmd", bookmakerId: "jun88", lobbyId: "cmd" };
    const sink = new BackendCollectorStreamSink(`http://127.0.0.1:${address.port}`, source);
    const liveHandler = {
      async prepare(request) {
        return {
          result: "prepared",
          prepareId: `prepare:${request.attemptId}`,
          slipFingerprint: "slip-fingerprint",
          displayedOdds: -0.92,
          rawOdds: -0.92,
          oddsFormat: "malay",
          minimumStakeVnd: 20_000,
          maximumStakeVnd: 500_000,
          stakeIncrementVnd: 1_000,
          balanceVnd: 1_000_000,
          sessionGeneration: "generation-1",
          observedAt: new Date().toISOString(),
        };
      },
      async commit(request) {
        return {
          result: "odds_changed",
          observedAt: new Date().toISOString(),
          submittedOdds: request.expectedOdds,
          offeredOdds: -0.88,
          confirmationRequired: true,
        };
      },
      async cancel() {
        return { result: "cancelled", observedAt: new Date().toISOString() };
      },
      async reconcile() {
        return {
          result: "submission_unknown",
          observedAt: new Date().toISOString(),
          error: "history unavailable",
        };
      },
    };
    await sink.pushAccountBalance({
      source,
      observedAt: "2026-08-14T12:00:00.000Z",
      amount: 1234.5,
      currency: "VD",
      amountVnd: 1_234_500,
      displayText: "VD 1,234.50",
    });
    await sink.pushBootstrap({
      source,
      collectedAt: new Date().toISOString(),
      selections: [],
    });
    assert.ok(socket);
    const hello = frames.find((frame) => frame.type === "hello");
    assert.equal(hello.protocol_version, 4);
    assert.equal(hello.account_id, "account-test");
    assert.deepEqual(hello.capabilities.sort(), [
      "account_balance_v1",
      "bet_commit_v1",
      "bet_prepare_v1",
      "bet_reconcile_v1",
    ]);
    const query = new URL(connectionURL, "ws://127.0.0.1").searchParams;
    assert.equal(query.get("account_id"), "account-test");
    assert.equal(query.get("access_token"), "token-test");
    const accountBalance = await waitForFrame(
      frames,
      waiters,
      (frame) => frame.type === "account_balance",
    );
    assert.equal(accountBalance.protocol_version, 4);
    assert.equal(accountBalance.session_id, sessionId);
    assert.equal(accountBalance.account_id, "account-test");
    assert.deepEqual(accountBalance.source, {
      collector_id: "jun88-cmd",
      bookmaker_id: "jun88",
      lobby_id: "cmd",
    });
    assert.deepEqual(accountBalance.balance, {
      amount: 1234.5,
      currency: "VD",
      amount_vnd: 1_234_500,
      display_text: "VD 1,234.50",
    });
    // Login/runtime initialization may install the DOM handler after a
    // heartbeat has already opened the socket. Capabilities come from the
    // feature flags so this session remains usable once the handler arrives.
    sink.setLiveBetHandler(liveHandler);

    socket.send(JSON.stringify(liveCommand({ type: "prepare_bet", sessionId })));
    const prepared = await waitForFrame(frames, waiters, (frame) => frame.type === "bet_prepared");
    assert.equal(prepared.result, "prepared");
    assert.equal(prepared.prepare_id, "prepare:attempt-live-1");
    assert.equal(prepared.action_id, "action-live-1");
    assert.equal(prepared.account_id, "account-test");

    socket.send(JSON.stringify(liveCommand({
      type: "commit_bet",
      sessionId,
      prepareId: prepared.prepare_id,
      idempotencyKey: "action-live-1:jun88:commit",
    })));
    const committed = await waitForFrame(frames, waiters, (frame) => frame.type === "bet_result");
    assert.equal(committed.result, "odds_changed");
    assert.equal(committed.offered_odds, -0.88);
    assert.equal(committed.attempt_id, "attempt-live-commit_bet");
    assert.equal(committed.idempotency_key, "action-live-1:jun88:commit");

    socket.send(JSON.stringify(liveCommand({
      type: "cancel_prepared_bet",
      sessionId,
      prepareId: prepared.prepare_id,
    })));
    const cancelled = await waitForFrame(frames, waiters, (frame) => frame.type === "bet_cancelled");
    assert.equal(cancelled.result, "cancelled");

    socket.send(JSON.stringify(liveCommand({
      type: "reconcile_bet",
      sessionId,
      idempotencyKey: "action-live-1:jun88:commit",
    })));
    const reconciled = await waitForFrame(frames, waiters, (frame) => frame.type === "bet_reconciled");
    assert.equal(reconciled.result, "submission_unknown");

    socket.terminate();
  } finally {
    await new Promise((resolve) => server.close(resolve));
    restoreEnv("COLLECTOR_ACCOUNT_ID", previous.account);
    restoreEnv("COLLECTOR_STREAM_TOKEN", previous.token);
    restoreEnv("AUTO_BET_MODE", previous.mode);
  }
}

function liveCommand({ type, sessionId, prepareId, idempotencyKey }) {
  return {
    type,
    protocol_version: 4,
    session_id: sessionId,
    request_id: `request-${type}`,
    action_id: "action-live-1",
    attempt_id: type === "prepare_bet" ? "attempt-live-1" : `attempt-live-${type}`,
    opportunity_id: "opportunity-live-1",
    leg_id: "leg-live-1",
    account_id: "account-test",
    source: { collector_id: "jun88-cmd", bookmaker_id: "jun88", lobby_id: "cmd" },
    fixture_id: "fixture-live-1",
    market_id: "hdp-ah",
    outcome_id: "outcome-live-1",
    provider_ref: "25212060_Hdp_Home",
    expected_odds: -0.92,
    expected_raw_odds: -0.92,
    odds_format: "malay",
    quote_revision: "quote-1",
    prepare_id: prepareId,
    idempotency_key: idempotencyKey,
    stake_vnd: 50_000,
    expires_at: new Date(Date.now() + 10_000).toISOString(),
  };
}

function restoreEnv(key, value) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function simulationSelection(odds) {
  return {
    fixtureId: "fixture-1",
    sport: "football",
    homeTeam: "Home",
    awayTeam: "Away",
    marketId: "o-u-ou",
    outcomeId: "over-2.5",
    outcomeName: "Over 2.5",
    odds,
    availableStake: 0,
    suspended: false,
    sourceEventId: "cmd:event-1",
    rawOdds: odds,
    oddsFormat: "malay",
    providerRef: "fixture-1|ou|ov|0",
  };
}

function simulationCommand({ type, requestId, sessionId, idempotencyKey }) {
  return {
    type,
    session_id: sessionId,
    request_id: requestId,
    action_id: "action-1",
    opportunity_id: "opportunity-1",
    leg_id: "jun88-leg",
    sequence: 1,
    fixture_id: "fixture-1",
    market_id: "o-u-ou",
    outcome_id: "over-2.5",
    expected_odds: -0.92,
    stake_vnd: 50_000,
    expires_at: new Date(Date.now() + 10_000).toISOString(),
    timeout_ms: 2_000,
    idempotency_key: idempotencyKey,
  };
}

function waitForFrame(frames, waiters, predicate) {
  const existing = frames.find(predicate);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      const index = waiters.indexOf(waiter);
      if (index >= 0) waiters.splice(index, 1);
      reject(new Error("timed out waiting for collector simulation frame"));
    }, 2_000);
    const waiter = {
      predicate,
      resolve: (frame) => {
        clearTimeout(timeout);
        resolve(frame);
      },
    };
    waiters.push(waiter);
  });
}
