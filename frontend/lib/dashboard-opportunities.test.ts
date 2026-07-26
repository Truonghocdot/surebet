import assert from "node:assert/strict";
import test from "node:test";
import type { BackendOdds, BackendOpportunity } from "@/lib/server-dashboard-data";
import {
  buildActiveDashboardOpportunities,
  createDashboardOpportunityStabilizer
} from "@/lib/dashboard-opportunities";

test("formats an active over-under pair with line and source", () => {
  const now = Date.now();
  const odds = [
    quote({
      bookmaker_id: "jun88",
      lobby_id: "cmd",
      fixture_id: "cmd-match",
      side: "over",
      line: "3",
      outcome_id: "cmd-over-3",
      outcome_name: "Over 3",
      odds: -0.8
    }),
    quote({
      bookmaker_id: "8xbet",
      lobby_id: "default",
      fixture_id: "8xbet-match",
      side: "under",
      line: "3",
      outcome_id: "8xbet-under-3",
      outcome_name: "Under 3",
      odds: -0.9
    })
  ];

  const items = buildActiveDashboardOpportunities(
    [opportunity(odds, now)],
    odds,
    now
  );

  assert.equal(items.length, 1);
  assert.equal(items[0].match_name, "Team A vs Team B");
  assert.equal(items[0].market_label, "Tài xỉu - Toàn trận");
  assert.deepEqual(
    items[0].legs.map((leg) => [leg.selection_label, leg.source_label]),
    [["Tài 3", "CMD"], ["Xỉu 3", "8xbet"]]
  );
});

test("formats split handicap lines as signed quarter lines", () => {
  const now = Date.now();
  const odds = [
    quote({
      bookmaker_id: "jun88",
      lobby_id: "cmd",
      fixture_id: "cmd-match",
      market_type: "handicap",
      market_id: "hdp-ah",
      side: "home",
      line: "0.5/1",
      outcome_id: "cmd-home",
      outcome_name: "Team A -0.5/1",
      odds: -0.8
    }),
    quote({
      bookmaker_id: "8xbet",
      lobby_id: "default",
      fixture_id: "8xbet-match",
      market_type: "handicap",
      market_id: "hdp-ah",
      side: "away",
      line: "0.5/1",
      outcome_id: "8xbet-away",
      outcome_name: "Team B +0.5/1",
      odds: -0.9
    })
  ];

  const items = buildActiveDashboardOpportunities(
    [opportunity(odds, now, "hdp-ah")],
    odds,
    now
  );

  assert.equal(items[0].market_label, "Kèo chấp - Toàn trận");
  assert.deepEqual(
    items[0].legs.map((leg) => leg.selection_label),
    ["Team A -0.75", "Team B +0.75"]
  );
});

test("keeps zero handicap signs visible", () => {
  const now = Date.now();
  const odds = [
    quote({
      outcome_id: "home-zero",
      market_type: "handicap",
      market_id: "hdp-ah",
      side: "home",
      line: "0",
      outcome_name: "Team A -0"
    }),
    quote({
      bookmaker_id: "8xbet",
      lobby_id: "default",
      fixture_id: "other-zero",
      outcome_id: "away-zero",
      market_type: "handicap",
      market_id: "hdp-ah",
      side: "away",
      line: "0",
      outcome_name: "Team B +0"
    })
  ];

  const items = buildActiveDashboardOpportunities(
    [opportunity(odds, now, "hdp-ah")],
    odds,
    now
  );

  assert.deepEqual(
    items[0].legs.map((leg) => leg.selection_label),
    ["Team A -0", "Team B +0"]
  );
});

test("rejects a candidate when an exact active leg is gone or changed", () => {
  const now = Date.now();
  const odds = [quote({ outcome_id: "over", side: "over", outcome_name: "Over 3" }),
    quote({ bookmaker_id: "8xbet", fixture_id: "other", outcome_id: "under", side: "under", outcome_name: "Under 3" })];
  const candidate = opportunity(odds, now);

  assert.equal(buildActiveDashboardOpportunities([candidate], odds.slice(0, 1), now).length, 0);
  assert.equal(buildActiveDashboardOpportunities([candidate], [odds[0], { ...odds[1], odds: -0.5 }], now).length, 0);
});

test("keeps order through one detector miss but drops an inactive leg immediately", () => {
  const now = Date.now();
  const odds = [quote({ outcome_id: "over", side: "over", outcome_name: "Over 3" }),
    quote({ bookmaker_id: "8xbet", fixture_id: "other", outcome_id: "under", side: "under", outcome_name: "Under 3" })];
  const current = buildActiveDashboardOpportunities([opportunity(odds, now)], odds, now);
  const stabilize = createDashboardOpportunityStabilizer({ missingGraceMs: 10_000 });

  assert.equal(stabilize(current, odds, now).length, 1);
  assert.equal(stabilize([], odds, now + 5_000).length, 1);
  assert.equal(stabilize([], odds.slice(0, 1), now + 6_000).length, 0);
});

function opportunity(
  odds: BackendOdds[],
  now: number,
  marketName = "o-u-ou"
): BackendOpportunity {
  return {
    id: `opportunity-${marketName}`,
    fixture_id: "team a vs team b",
    market_name: marketName,
    profit_percentage: 5,
    expected_return: 0.05,
    detected_at: new Date(now).toISOString(),
    expires_at: new Date(now + 60_000).toISOString(),
    verification_status: "candidate",
    match_ambiguous: false,
    legs: odds.map((item) => ({
      bookmaker_id: item.bookmaker_id,
      lobby_id: item.lobby_id,
      fixture_id: item.fixture_id,
      market_id: item.market_id,
      outcome_id: item.outcome_id,
      outcome_name: item.outcome_name,
      odds: item.odds
    }))
  };
}

function quote(overrides: Partial<BackendOdds>): BackendOdds {
  return {
    bookmaker_id: "jun88",
    lobby_id: "cmd",
    fixture_id: "fixture",
    fixture_marker: "fixture",
    league_name: "League",
    home_team: "Team A",
    away_team: "Team B",
    match_state: "live",
    match_name: "Team A vs Team B",
    period: "FT",
    market_type: "over_under",
    line: "3",
    side: "over",
    market_id: "o-u-ou",
    outcome_id: "outcome",
    outcome_name: "Over 3",
    odds: -0.8,
    decimal_odds: 2.25,
    available_stake: 0,
    suspended: false,
    collected_at: new Date().toISOString(),
    ...overrides
  };
}
