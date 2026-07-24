import assert from "node:assert/strict";
import test from "node:test";
import type { OpportunityBoard } from "@/features/dashboard/schemas/crm-schemas";
import {
  applyRealtimeMatchedFixtures,
  applyRealtimeOddsQuotes,
  applyRealtimeVerification,
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

test("promotes only a confirmed verification event to actionable legs", () => {
  const result = applyRealtimeVerification(createBoard(), {
    opportunity_id: "opportunity-a",
    status: "confirmed",
    confirmed_at: "2026-07-18T08:00:01Z",
    valid_until: "2099-07-18T08:00:03Z",
    opportunity: {
      id: "opportunity-a",
      fixture_id: "fixture-match",
      market_name: "hdp-ah",
      profit_percentage: 2.4,
      expected_return: 0.024,
      detected_at: "2026-07-18T08:00:00Z",
      expires_at: "2099-07-18T08:00:03Z",
      verification_status: "confirmed",
      confirmed_at: "2026-07-18T08:00:01Z",
      valid_until: "2099-07-18T08:00:03Z",
      legs: [
        {
          bookmaker_id: "8xbet",
          lobby_id: "default",
          fixture_id: "fixture-8x",
          market_id: "hdp-ah",
          outcome_id: "fixture-8x:hdp-ah:home-0-5",
          outcome_name: "Home +0.5",
          odds: -0.91,
          stake: 0.5
        }
      ]
    }
  });

  assert.equal(result.items[0].verification_status, "confirmed");
  assert.equal(result.items[0].sources[0].handicap[0].outcomes[0].odds, -0.91);
  assert.equal(result.items[0].sources[0].handicap[0].outcomes[0].is_surebet_leg, true);
});

test("clears an expired opportunity without waiting for REST", () => {
  const board = createBoard();
  board.items[0].verification_status = "confirmed";
  board.items[0].valid_until = "2099-07-18T08:00:03Z";

  const result = applyRealtimeVerification(board, {
    opportunity_id: "opportunity-a",
    status: "expired"
  });

  assert.equal(result.items[0].verification_status, "none");
  assert.equal(result.items[0].has_surebet, false);
  assert.equal(result.items[0].opportunity_id, "");
  assert.equal(result.items[0].valid_until, "");
  assert.equal(result.items[0].sources[0].handicap[0].outcomes[0].is_surebet_leg, false);
  assert.equal(result.items[0].sources[0].handicap[0].outcomes[0].is_candidate_leg, false);
});

test("patches matched fixture source timestamps directly from websocket quotes", () => {
  const snapshot = {
    summary: {
      matched_fixtures: 1,
      active_sources: 2,
      total_quotes: 4,
      latest_collected_at: "2026-07-18T08:00:00Z"
    },
    items: [
      {
        id: "fixture-match",
        fixture_marker: "home vs away",
        match_name: "Home vs Away",
        league_names: ["League"],
        match_state: "live",
        source_count: 2,
        quote_count: 4,
        market_count: 1,
        latest_collected_at: "2026-07-18T08:00:00Z",
        sources: [
          {
            source_id: "8xbet/default",
            bookmaker_id: "8xbet",
            lobby_id: "default",
            fixture_id: "fixture-8x",
            home_team: "Home",
            away_team: "Away",
            match_state: "live",
            quote_count: 2,
            market_count: 1,
            latest_collected_at: "2026-07-18T08:00:00Z"
          },
          {
            source_id: "jun88/cmd",
            bookmaker_id: "jun88",
            lobby_id: "cmd",
            fixture_id: "fixture-cmd",
            home_team: "Home FC",
            away_team: "Away FC",
            match_state: "live",
            quote_count: 2,
            market_count: 1,
            latest_collected_at: "2026-07-18T08:00:00Z"
          }
        ]
      }
    ]
  };
  const next = applyRealtimeMatchedFixtures(snapshot, [
    realtimeQuote({ collected_at: "2026-07-18T08:00:02Z" })
  ]);

  assert.equal(next.summary.latest_collected_at, "2026-07-18T08:00:02Z");
  assert.equal(
    next.items[0].sources[0].latest_collected_at,
    "2026-07-18T08:00:02Z"
  );
  assert.equal(
    next.items[0].sources[1].latest_collected_at,
    "2026-07-18T08:00:00Z"
  );
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
        opportunity_id: "opportunity-a",
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
        verification_status: "candidate",
        valid_until: "",
        match_confidence: 1,
        match_ambiguous: false,
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
                    is_surebet_leg: true,
                    is_candidate_leg: true
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
