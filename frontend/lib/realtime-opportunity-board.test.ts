import assert from "node:assert/strict";
import test from "node:test";
import type { OpportunityBoard } from "@/features/dashboard/schemas/crm-schemas";
import {
  applyRealtimeOddsQuotes,
  type RealtimeOddsQuote
} from "@/lib/realtime-opportunity-board";

test("patches a known quote immediately and clears stale surebet state", () => {
  const result = applyRealtimeOddsQuotes(createBoard(), [
    realtimeQuote({ odds: -0.72 })
  ]);

  assert.equal(result.changed, true);
  assert.equal(result.needsReconcile, true);
  assert.equal(result.board.items[0].has_surebet, false);
  assert.equal(
    result.board.items[0].sources[0].handicap[0].outcomes[0].odds,
    -0.72
  );
  assert.equal(
    result.board.items[0].sources[0].handicap[0].outcomes[0].is_surebet_leg,
    false
  );
});

test("removes a suspended outcome without waiting for REST", () => {
  const result = applyRealtimeOddsQuotes(createBoard(), [
    realtimeQuote({ suspended: true })
  ]);

  assert.equal(result.changed, true);
  assert.equal(result.board.items[0].sources[0].handicap.length, 0);
});

test("requests reconciliation when a new standard outcome is not on the board", () => {
  const result = applyRealtimeOddsQuotes(createBoard(), [
    realtimeQuote({ outcome_id: "fixture-8x:hdp-ah:away-0-5" })
  ]);

  assert.equal(result.changed, false);
  assert.equal(result.needsReconcile, true);
});

function realtimeQuote(
  overrides: Partial<RealtimeOddsQuote> = {}
): RealtimeOddsQuote {
  return {
    bookmaker_id: "8xbet",
    lobby_id: "default",
    fixture_id: "fixture-8x",
    market_id: "hdp-ah",
    outcome_id: "fixture-8x:hdp-ah:home-0-5",
    odds: -0.8,
    collected_at: "2026-07-18T08:00:01Z",
    ...overrides
  };
}

function createBoard(): OpportunityBoard {
  return {
    items: [
      {
        id: "fixture-match",
        match_name: "Home vs Away",
        match_state: "live",
        market_name: "hdp-ah",
        profit_percentage: 2,
        expected_return: 2,
        odds_profile: "two_negative",
        latest_collected_at: "2026-07-18T08:00:00Z",
        confirmed_at: "2026-07-18T08:00:00Z",
        expires_at: "2026-07-18T08:00:15Z",
        league_names: ["League"],
        has_surebet: true,
        sources: [
          {
            id: "8xbet/default",
            bookmaker_id: "8xbet",
            lobby_id: "default",
            latest_collected_at: "2026-07-18T08:00:00Z",
            handicap: [
              {
                id: "market-8x",
                period: "FT",
                line: "0.5",
                outcomes: [
                  {
                    fixture_id: "fixture-8x",
                    outcome_id: "fixture-8x:hdp-ah:home-0-5",
                    outcome_name: "Home +0.5",
                    side: "home",
                    odds: -0.85,
                    collected_at: "2026-07-18T08:00:00Z",
                    is_surebet_leg: true
                  }
                ]
              }
            ],
            over_under: []
          },
          {
            id: "jun88/cmd",
            bookmaker_id: "jun88",
            lobby_id: "cmd",
            latest_collected_at: "2026-07-18T08:00:00Z",
            handicap: [],
            over_under: []
          }
        ]
      }
    ]
  };
}
