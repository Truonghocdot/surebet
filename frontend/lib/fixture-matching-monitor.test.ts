import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFixtureMatchingMonitor
} from "@/lib/fixture-matching-monitor";
import type { BackendOdds } from "@/lib/server-dashboard-data";

const now = Date.parse("2026-08-14T10:00:00.000Z");

test("counts each matched fixture once across repeated market quotes", () => {
  const odds = [
    quote({ bookmaker_id: "jun88", lobby_id: "cmd", fixture_id: "jun-a" }),
    quote({
      bookmaker_id: "jun88",
      lobby_id: "cmd",
      fixture_id: "jun-a",
      outcome_id: "away"
    }),
    quote({
      bookmaker_id: "8xbet",
      lobby_id: "default",
      fixture_id: "eight-a",
      home_team: "France",
      away_team: "England"
    })
  ];

  const monitor = buildFixtureMatchingMonitor(odds, now);

  assert.equal(monitor.matched_fixtures, 1);
  assert.equal(monitor.state, "matching");
  assert.deepEqual(
    monitor.sources.map((source) => source.active_fixtures),
    [1, 1]
  );
});

test("reports waiting when both sources have data without an overlapping fixture", () => {
  const monitor = buildFixtureMatchingMonitor([
    quote({ bookmaker_id: "jun88", lobby_id: "cmd", fixture_id: "jun-a" }),
    quote({
      bookmaker_id: "8xbet",
      lobby_id: "default",
      fixture_id: "eight-b",
      home_team: "Spain",
      away_team: "Portugal"
    })
  ], now);

  assert.equal(monitor.matched_fixtures, 0);
  assert.equal(monitor.state, "waiting");
});

test("reports a missing source and rejects fixtures with conflicting start times", () => {
  const missing = buildFixtureMatchingMonitor([
    quote({ bookmaker_id: "jun88", lobby_id: "cmd", fixture_id: "jun-a" })
  ], now);
  assert.equal(missing.state, "source_missing");

  const conflicting = buildFixtureMatchingMonitor([
    quote({
      bookmaker_id: "jun88",
      lobby_id: "cmd",
      fixture_id: "jun-a",
      event_start_at: "2026-08-14T10:00:00.000Z"
    }),
    quote({
      bookmaker_id: "8xbet",
      lobby_id: "default",
      fixture_id: "eight-a",
      home_team: "France",
      away_team: "England",
      event_start_at: "2026-08-14T10:16:00.000Z"
    })
  ], now);
  assert.equal(conflicting.matched_fixtures, 0);
  assert.equal(conflicting.state, "waiting");
});

function quote(overrides: Partial<BackendOdds>): BackendOdds {
  return {
    bookmaker_id: "jun88",
    lobby_id: "cmd",
    fixture_id: "fixture",
    fixture_marker: "france|england",
    league_name: "International",
    home_team: "Pháp",
    away_team: "Anh",
    match_state: "live",
    event_start_at: "2026-08-14T10:00:00.000Z",
    match_name: "Pháp vs Anh",
    period: "FT",
    market_type: "over_under",
    line: "2.5",
    side: "over",
    market_id: "ou",
    outcome_id: "home",
    outcome_name: "Over 2.5",
    odds: -0.9,
    decimal_odds: 2.11,
    available_stake: 0,
    suspended: false,
    collected_at: "2026-08-14T09:59:59.000Z",
    last_observed_at: "2026-08-14T09:59:59.000Z",
    ...overrides
  };
}
