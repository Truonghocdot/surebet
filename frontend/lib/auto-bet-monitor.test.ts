import assert from "node:assert/strict";
import test from "node:test";
import { selectLatestAccountBalance, summarizeAutoBetSnapshot } from "./auto-bet-monitor";
import type {
  AutoBetAction,
  AutoBetMonitorSnapshot,
  BetExposure,
  CollectorAccountBalance
} from "../features/auto-bet/schemas/auto-bet-schemas";
import {
  autoBetActionStatusSchema,
  autoBetMonitorSnapshotSchema,
  betAttemptStatusSchema,
  betExposureStatusSchema,
  collectorAccountBalanceSchema
} from "../features/auto-bet/schemas/auto-bet-schemas";

test("keeps unresolved actions and Jun88 exposures visible", () => {
  const snapshot = baseSnapshot();
  snapshot.actions.items = [
    action({ action_id: "running", status: "placing_jun88" }),
    action({ action_id: "done", status: "completed", completed_at: "2026-08-14T10:00:02Z" })
  ];
  snapshot.exposures.items = [
    exposure({ exposure_id: "open", status: "exposure_open" }),
    exposure({ exposure_id: "closed", status: "completed", completed_at: "2026-08-14T10:00:04Z" })
  ];

  const result = summarizeAutoBetSnapshot(snapshot);

  assert.deepEqual(result.currentActions.map((item) => item.action_id), ["running"]);
  assert.deepEqual(result.trackedExposures.map((item) => item.exposure_id), ["open"]);
  assert.equal(result.openExposureCount, 1);
  assert.equal(result.health, "monitoring");
});

test("treats submission unknown and an unhedged close as critical", () => {
  const snapshot = baseSnapshot();
  snapshot.actions.items = [action({ status: "submission_unknown" })];
  snapshot.exposures.items = [
    exposure({ status: "unhedged_closed", market_closed_at: "2026-08-14T10:02:00Z" })
  ];

  const result = summarizeAutoBetSnapshot(snapshot);

  assert.equal(result.unknownCount, 1);
  assert.equal(result.criticalCount, 1);
  assert.equal(result.health, "critical");
  assert.equal(result.trackedExposures.length, 1);
});

test("reports endpoint loss separately from a valid empty response", () => {
  const unavailable = baseSnapshot();
  unavailable.exposures.state = "unavailable";
  unavailable.exposures.error = "endpoint is not configured";

  assert.equal(summarizeAutoBetSnapshot(unavailable).health, "unavailable");
  assert.equal(summarizeAutoBetSnapshot(baseSnapshot()).health, "idle");
});

test("does not show terminal dry-run or unhedged actions as active", () => {
  const snapshot = baseSnapshot();
  snapshot.actions.items = [
    action({ action_id: "dry-run", status: "dry_run_completed" }),
    action({ action_id: "closed", status: "unhedged_closed" }),
    action({ action_id: "reprice", status: "awaiting_odds_confirmation" })
  ];

  const result = summarizeAutoBetSnapshot(snapshot);

  assert.deepEqual(result.currentActions.map((item) => item.action_id), ["reprice"]);
});

test("keeps action, exposure and attempt status domains distinct", () => {
  assert.equal(autoBetActionStatusSchema.safeParse("dry_run_completed").success, true);
  assert.equal(betExposureStatusSchema.safeParse("unhedged_closed").success, true);
  assert.equal(betAttemptStatusSchema.safeParse("awaiting_reconcile").success, true);
  assert.equal(autoBetActionStatusSchema.safeParse("awaiting_reconcile").success, false);
  assert.equal(betExposureStatusSchema.safeParse("awaiting_reconcile").success, false);
});

test("selects the newest account balance for each bookmaker", () => {
  const items = [
    accountBalance({ collector_id: "jun88-cmd-1", received_at: "2026-08-14T10:00:02Z" }),
    accountBalance({
      collector_id: "jun88-cmd-2",
      amount: 123.45,
      received_at: "2026-08-14T10:00:05Z"
    }),
    accountBalance({
      bookmaker_id: "8xbet",
      collector_id: "8xbet-worker",
      lobby_id: "",
      amount: 500_000,
      currency: "VND",
      received_at: "2026-08-14T10:00:03Z"
    })
  ];

  assert.equal(selectLatestAccountBalance(items, "jun88-cmd")?.amount, 123.45);
  assert.equal(selectLatestAccountBalance(items, "8xbet")?.amount, 500_000);
});

test("accepts an older monitor payload while marking balances unavailable", () => {
  const payload = baseSnapshot() as Record<string, unknown>;
  delete payload.balances;

  const parsed = autoBetMonitorSnapshotSchema.parse(payload);

  assert.equal(parsed.balances.state, "unavailable");
  assert.deepEqual(parsed.balances.items, []);
});

test("normalizes the nested backend balance DTO for the monitor", () => {
  const parsed = collectorAccountBalanceSchema.parse({
    account_id: "account-1",
    source: {
      collector_id: "jun88-cmd-worker",
      bookmaker_id: "jun88",
      lobby_id: "cmd"
    },
    balance: {
      amount: 125.5,
      currency: "VD",
      display_text: "VD 125.50"
    },
    observed_at: "2026-08-14T10:00:00Z",
    received_at: "2026-08-14T10:00:01Z",
    stale: false
  });

  assert.equal(parsed.bookmaker_id, "jun88");
  assert.equal(parsed.amount, 125.5);
  assert.equal(parsed.amount_vnd, undefined);
});

function baseSnapshot(): AutoBetMonitorSnapshot {
  return {
    checked_at: "2026-08-14T10:00:00Z",
    runtime: {
      state: "dry_run",
      live_enabled: true,
      commit_enabled: false,
      account_configured: true,
      total_stake_vnd: 100_000
    },
    actions: { state: "available", items: [] },
    exposures: { state: "available", items: [] },
    balances: { state: "available", items: [] }
  };
}

function action(overrides: Partial<AutoBetAction> = {}): AutoBetAction {
  return {
    action_id: "action-1",
    opportunity_id: "opportunity-1",
    mode: "live",
    status: "ready",
    currency: "VND",
    total_stake_vnd: 100_000,
    expected_return: 0,
    legs: [],
    exposure_open: false,
    reprice_revision: 0,
    reserved_stake_vnd: 100_000,
    version: 1,
    created_at: "2026-08-14T10:00:00Z",
    updated_at: "2026-08-14T10:00:01Z",
    ...overrides
  };
}

function exposure(overrides: Partial<BetExposure> = {}): BetExposure {
  return {
    exposure_id: "exposure-1",
    action_id: "action-1",
    account_id: "account-1",
    status: "exposure_open",
    currency: "VND",
    version: 1,
    jun88_ticket_id: "JUN-100",
    jun88_provider_reference: "25212060_Hdp_Home",
    jun88_accepted_odds: -0.93,
    jun88_stake_vnd: 50_000,
    jun88_accepted_at: "2026-08-14T10:00:00Z",
    hedge_provider_reference: "oddsBtn-1|4928833|ah|h|0",
    current_hedge_odds: -0.9,
    required_hedge_stake_vnd: 51_000,
    projected_jun_profit_vnd: 400,
    projected_hedge_profit_vnd: 350,
    opened_at: "2026-08-14T10:00:00Z",
    ...overrides
  };
}

function accountBalance(
  overrides: Partial<CollectorAccountBalance> = {}
): CollectorAccountBalance {
  return {
    account_id: "account-1",
    collector_id: "jun88-cmd-worker",
    bookmaker_id: "jun88",
    lobby_id: "cmd",
    amount: 100,
    currency: "VD",
    amount_vnd: 100_000,
    display_text: "VD 100.00",
    observed_at: "2026-08-14T10:00:00Z",
    received_at: "2026-08-14T10:00:01Z",
    stale: false,
    ...overrides
  };
}
