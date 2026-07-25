import assert from "node:assert/strict";
import test from "node:test";
import type { BackendOdds, BackendOpportunity } from "@/lib/server-dashboard-data";
import { buildCurrentOpportunityBoard } from "@/lib/opportunity-board";

test("keeps an ambiguous match visible without promoting it as a surebet", () => {
  const now = new Date();
  const future = new Date(now.getTime() + 60_000).toISOString();
  const detectedAt = now.toISOString();
  const odds = [
    quote({
      bookmaker_id: "8xbet",
      lobby_id: "default",
      fixture_id: "4841075",
      home_team: "IF Volsungur",
      away_team: "UMF Grindavik",
      outcome_id: "4841075:hdp-ah:if-volsungur-0",
      outcome_name: "IF Volsungur +0",
      side: "home",
      odds: 0.75,
      collected_at: detectedAt
    }),
    quote({
      bookmaker_id: "8xbet",
      lobby_id: "default",
      fixture_id: "4841075",
      home_team: "IF Volsungur",
      away_team: "UMF Grindavik",
      outcome_id: "4841075:hdp-ah:umf-grindavik-0",
      outcome_name: "UMF Grindavik -0",
      side: "away",
      odds: -0.89,
      collected_at: detectedAt
    }),
    quote({
      bookmaker_id: "jun88",
      lobby_id: "cmd",
      fixture_id: "cmd-volsungur",
      home_team: "Volsungur",
      away_team: "Grindavik",
      outcome_id: "cmd-volsungur:hdp-ah:volsungur-0",
      outcome_name: "Volsungur +0",
      side: "home",
      odds: 0.75,
      collected_at: detectedAt
    }),
    quote({
      bookmaker_id: "jun88",
      lobby_id: "cmd",
      fixture_id: "cmd-volsungur",
      home_team: "Volsungur",
      away_team: "Grindavik",
      outcome_id: "cmd-volsungur:hdp-ah:grindavik-0",
      outcome_name: "Grindavik -0",
      side: "away",
      odds: -0.87,
      collected_at: detectedAt
    })
  ];
  const opportunity: BackendOpportunity = {
    id: "ambiguous-volsungur",
    fixture_id: "grindavik vs volsungur",
    market_name: "hdp-ah",
    profit_percentage: 6,
    expected_return: 0.06,
    detected_at: detectedAt,
    expires_at: future,
    verification_status: "candidate",
    match_confidence: 0.67,
    match_ambiguous: true,
    legs: odds.filter((item) => item.side === "away").map((item) => ({
      bookmaker_id: item.bookmaker_id,
      lobby_id: item.lobby_id,
      fixture_id: item.fixture_id,
      market_id: item.market_id,
      outcome_id: item.outcome_id,
      outcome_name: item.outcome_name,
      odds: item.odds,
      stake: 0.5
    }))
  };

  const board = buildCurrentOpportunityBoard([opportunity], odds);

  assert.equal(board.length, 1);
  assert.equal(board[0].sources.length, 2);
  assert.equal(board[0].has_surebet, false);
  assert.equal(board[0].opportunity_id, "");
  assert.equal(board[0].verification_status, "none");
  assert.equal(board[0].match_ambiguous, false);
  for (const source of board[0].sources) {
    assert.deepEqual(
      source.handicap[0].outcomes.map((outcome) => outcome.side),
      ["home", "away"]
    );
  }
  const cmd = board[0].sources.find((source) => source.bookmaker_id === "jun88");
  assert.deepEqual(
    cmd?.handicap[0].outcomes.map((outcome) => [outcome.outcome_name, outcome.odds]),
    [["Volsungur +0", 0.75], ["Grindavik -0", -0.87]]
  );
});

test("drops a previous-day fixture even when its quotes were just recollected", () => {
  const collectedAt = new Date().toISOString();
  const expiredStartAt = new Date(Date.now() - 7 * 60 * 60 * 1_000).toISOString();
  const odds = [
    quote({
      bookmaker_id: "8xbet",
      fixture_id: "expired-8xbet",
      event_start_at: expiredStartAt,
      outcome_id: "expired-8xbet:home",
      collected_at: collectedAt
    }),
    quote({
      bookmaker_id: "jun88",
      lobby_id: "cmd",
      fixture_id: "expired-cmd",
      outcome_id: "expired-cmd:home",
      collected_at: collectedAt
    })
  ];

  assert.deepEqual(buildCurrentOpportunityBoard([], odds), []);
});

test("drops a finished fixture from the shared matches board", () => {
  const collectedAt = new Date().toISOString();
  const odds = [
    quote({
      bookmaker_id: "8xbet",
      fixture_id: "finished-8xbet",
      match_state: "finished",
      outcome_id: "finished-8xbet:home",
      collected_at: collectedAt
    }),
    quote({
      bookmaker_id: "jun88",
      lobby_id: "cmd",
      fixture_id: "finished-cmd",
      match_state: "finished",
      outcome_id: "finished-cmd:home",
      collected_at: collectedAt
    })
  ];

  assert.deepEqual(buildCurrentOpportunityBoard([], odds), []);
});

function quote(overrides: Partial<BackendOdds>): BackendOdds {
  return {
    bookmaker_id: "bookmaker",
    lobby_id: "default",
    fixture_id: "fixture",
    fixture_marker: "",
    league_name: "Iceland League",
    home_team: "Home",
    away_team: "Away",
    match_state: "live",
    match_name: "Home vs Away",
    period: "FT",
    market_type: "handicap",
    line: "0",
    side: "home",
    market_id: "hdp-ah",
    outcome_id: "outcome",
    outcome_name: "Home +0",
    odds: -0.8,
    decimal_odds: 2.25,
    available_stake: 0,
    suspended: false,
    collected_at: new Date().toISOString(),
    ...overrides
  };
}
