import assert from "node:assert/strict";
import test from "node:test";
import type {
  OpportunityBoard,
  OpportunityBoardSource
} from "@/features/dashboard/schemas/crm-schemas";
import { mergeOpportunityBoardsMonotonically } from "@/lib/opportunity-board-merge";

test("keeps a WebSocket price when an older REST board finishes later", () => {
  const websocket = board([
    source("jun88", "cmd", "2026-07-27T08:00:20Z", -0.72)
  ]);
  const staleREST = board([
    source("jun88", "cmd", "2026-07-27T08:00:10Z", -0.85)
  ]);

  const merged = mergeOpportunityBoardsMonotonically(websocket, staleREST);

  assert.equal(oddsFor(merged, "jun88"), -0.72);
  assert.equal(merged.items[0], websocket.items[0]);
});

test("merges sources independently when another source makes REST globally newer", () => {
  const websocket = board([
    source("8xbet", "default", "2026-07-27T08:00:15Z", -0.8),
    source("jun88", "cmd", "2026-07-27T08:00:20Z", -0.72)
  ]);
  const mixedREST = board([
    source("8xbet", "default", "2026-07-27T08:00:30Z", -0.76),
    source("jun88", "cmd", "2026-07-27T08:00:10Z", -0.85)
  ]);

  const merged = mergeOpportunityBoardsMonotonically(websocket, mixedREST);

  assert.equal(oddsFor(merged, "8xbet"), -0.76);
  assert.equal(oddsFor(merged, "jun88"), -0.72);
  assert.equal(
    merged.items[0].sources.find((item) => item.bookmaker_id === "jun88"),
    websocket.items[0].sources.find((item) => item.bookmaker_id === "jun88")
  );
});

test("accepts a REST source whose observation is newer", () => {
  const websocket = board([
    source("jun88", "cmd", "2026-07-27T08:00:20Z", -0.72)
  ]);
  const freshREST = board([
    source("jun88", "cmd", "2026-07-27T08:00:30Z", -0.69)
  ]);

  const merged = mergeOpportunityBoardsMonotonically(websocket, freshREST);

  assert.equal(merged, freshREST);
  assert.equal(oddsFor(merged, "jun88"), -0.69);
});

test("merges each source even when another previous source has the newest fixture timestamp", () => {
  const websocket = board([
    source("8xbet", "default", "2026-07-27T08:00:40Z", -0.8),
    source("jun88", "cmd", "2026-07-27T08:00:10Z", -0.85)
  ]);
  const mixedREST = board([
    source("8xbet", "default", "2026-07-27T08:00:30Z", -0.76),
    source("jun88", "cmd", "2026-07-27T08:00:35Z", -0.72)
  ]);

  const merged = mergeOpportunityBoardsMonotonically(websocket, mixedREST);

  assert.equal(oddsFor(merged, "8xbet"), -0.8);
  assert.equal(oddsFor(merged, "jun88"), -0.72);
});

function board(sources: OpportunityBoardSource[]): OpportunityBoard {
  const latestObservedAt = sources
    .map((sourceItem) => sourceItem.latest_observed_at || sourceItem.latest_collected_at)
    .sort()
    .at(-1) ?? "";
  return {
    items: [{
      id: "matched-fixture",
      opportunity_id: "",
      match_name: "Home vs Away",
      match_state: "live",
      market_name: "",
      profit_percentage: 0,
      expected_return: 0,
      odds_profile: "unknown",
      latest_collected_at: latestObservedAt,
      latest_observed_at: latestObservedAt,
      confirmed_at: "",
      expires_at: "",
      league_names: ["League"],
      has_surebet: false,
      verification_status: "none",
      valid_until: "",
      match_confidence: 1,
      match_ambiguous: false,
      sources
    }]
  };
}

function source(
  bookmakerID: string,
  lobbyID: string,
  observedAt: string,
  homeOdds: number
): OpportunityBoardSource {
  const fixtureID = `${bookmakerID}-fixture`;
  return {
    id: `${bookmakerID}/${lobbyID}`,
    bookmaker_id: bookmakerID,
    lobby_id: lobbyID,
    latest_collected_at: observedAt,
    latest_observed_at: observedAt,
    handicap: [{
      id: `${bookmakerID}-market`,
      period: "FT",
      line: "0.5",
      observed_at: observedAt,
      price_changed_at: observedAt,
      outcomes: [{
        fixture_id: fixtureID,
        outcome_id: `${fixtureID}-home`,
        outcome_name: "Home -0.5",
        side: "home",
        odds: homeOdds,
        collected_at: observedAt,
        observed_at: observedAt,
        price_changed_at: observedAt,
        is_stale: false,
        is_surebet_leg: false,
        is_candidate_leg: false
      }, {
        fixture_id: fixtureID,
        outcome_id: `${fixtureID}-away`,
        outcome_name: "Away +0.5",
        side: "away",
        odds: 0.76,
        collected_at: observedAt,
        observed_at: observedAt,
        price_changed_at: observedAt,
        is_stale: false,
        is_surebet_leg: false,
        is_candidate_leg: false
      }]
    }],
    over_under: []
  };
}

function oddsFor(value: OpportunityBoard, bookmakerID: string) {
  return value.items[0].sources
    .find((sourceItem) => sourceItem.bookmaker_id === bookmakerID)
    ?.handicap[0].outcomes[0].odds;
}
