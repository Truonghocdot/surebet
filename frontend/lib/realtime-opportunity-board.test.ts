import assert from "node:assert/strict";
import test from "node:test";
import type { OpportunityBoard } from "@/features/dashboard/schemas/crm-schemas";
import {
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

test("locks a suspended market without dropping the fixture shell", () => {
  const result = applyRealtimeOddsQuotes(createBoard(), [
    realtimeQuote({ suspended: true })
  ]);

  assert.equal(result.changed, true);
  assert.equal(result.board.items[0].sources[0].handicap.length, 1);
  assert.equal(result.board.items[0].sources[0].handicap[0].outcomes[0].odds, 0);
  assert.equal(result.board.items[0].sources[0].handicap[0].outcomes[0].is_stale, true);
});

test("locks both legs when realtime updates only one side of a two-sided market", () => {
  const board = createBoard();
  board.items[0].sources[0].handicap[0].outcomes.push({
    fixture_id: "fixture-8x",
    outcome_id: "fixture-8x:hdp-ah:away-0-5",
    outcome_name: "Away -0.5",
    side: "away",
    odds: 0.8,
    collected_at: "2026-07-18T08:00:00Z",
    is_surebet_leg: false,
    is_candidate_leg: false
  });

  const result = applyRealtimeOddsQuotes(board, [realtimeQuote({ odds: -0.72 })]);
  const outcomes = result.board.items[0].sources[0].handicap[0].outcomes;
  assert.equal(result.needsReconcile, true);
  assert.ok(outcomes.every((outcome) => outcome.odds === 0 && outcome.is_stale));
});

test("applies a complete coherent fixture market batch", () => {
  const board = createBoard();
  board.items[0].sources[0].handicap[0].outcomes.push({
    fixture_id: "fixture-8x",
    outcome_id: "fixture-8x:hdp-ah:away-0-5",
    outcome_name: "Away -0.5",
    side: "away",
    odds: 0.8,
    collected_at: "2026-07-18T08:00:00Z",
    is_surebet_leg: false,
    is_candidate_leg: false
  });

  const result = applyRealtimeOddsQuotes(board, [
    realtimeQuote({
      odds: -0.72,
      batch_id: "batch-2",
      coherence_status: "coherent",
      market_observed_at: "2026-07-18T08:00:03Z",
      price_changed_at: "2026-07-18T08:00:02Z"
    }),
    realtimeQuote({
      outcome_id: "fixture-8x:hdp-ah:away-0-5",
      odds: 0.76,
      batch_id: "batch-2",
      coherence_status: "coherent",
      market_observed_at: "2026-07-18T08:00:03Z",
      price_changed_at: "2026-07-18T08:00:02Z"
    })
  ]);
  const outcomes = result.board.items[0].sources[0].handicap[0].outcomes;
  assert.deepEqual(outcomes.map((outcome) => outcome.odds), [-0.72, 0.76]);
  assert.ok(outcomes.every((outcome) => !outcome.is_stale));
  assert.ok(outcomes.every((outcome) => outcome.observed_at === "2026-07-18T08:00:03Z"));
  assert.ok(outcomes.every((outcome) => outcome.price_changed_at === "2026-07-18T08:00:02Z"));
  assert.equal(result.board.items[0].sources[0].latest_observed_at, "2026-07-18T08:00:03Z");
});

test("uses changed_at instead of an observation refresh for the price timestamp", () => {
  const board = createBoard();
  board.items[0].sources[0].handicap[0].outcomes.push({
    fixture_id: "fixture-8x",
    outcome_id: "fixture-8x:hdp-ah:away-0-5",
    outcome_name: "Away -0.5",
    side: "away",
    odds: 0.8,
    collected_at: "2026-07-18T08:00:00Z",
    is_surebet_leg: false,
    is_candidate_leg: false
  });

  const result = applyRealtimeOddsQuotes(board, [
    realtimeQuote({
      odds: -0.72,
      collected_at: "2026-07-18T08:00:20Z",
      last_observed_at: "2026-07-18T08:00:20Z",
      changed_at: "2026-07-18T08:00:20Z"
    }),
    realtimeQuote({
      outcome_id: "fixture-8x:hdp-ah:away-0-5",
      odds: 0.8,
      collected_at: "2026-07-18T08:00:20Z",
      last_observed_at: "2026-07-18T08:00:20Z",
      changed_at: "2026-07-18T08:00:00Z"
    })
  ]);
  const outcomes = result.board.items[0].sources[0].handicap[0].outcomes;

  assert.equal(outcomes[0].price_changed_at, "2026-07-18T08:00:20Z");
  assert.equal(outcomes[1].price_changed_at, "2026-07-18T08:00:00Z");
  assert.ok(outcomes.every((outcome) => outcome.observed_at === "2026-07-18T08:00:20Z"));
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
        },
        {
          bookmaker_id: "jun88",
          lobby_id: "cmd",
          fixture_id: "fixture-cmd",
          market_id: "hdp-ah",
          outcome_id: "fixture-cmd:hdp-ah:away-0-5",
          outcome_name: "Away -0.5",
          odds: 0.82,
          stake: 0.5
        }
      ]
    }
  });

  assert.equal(result.items[0].verification_status, "confirmed");
  assert.equal(result.items[0].odds_profile, "one_negative_one_positive");
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

test("does not confirm when a CMD leg is no longer active on the board", () => {
  const board = createBoard();
  board.items[0].opportunity_id = "";
  board.items[0].has_surebet = false;
  board.items[0].verification_status = "none";

  const result = applyRealtimeVerification(board, {
    opportunity_id: "opportunity-missing-line",
    status: "confirmed",
    opportunity: {
      id: "opportunity-missing-line",
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
        },
        {
          bookmaker_id: "jun88",
          lobby_id: "cmd",
          fixture_id: "fixture-cmd",
          market_id: "hdp-ah",
          outcome_id: "fixture-cmd:hdp-ah:away-1-5",
          outcome_name: "Away -1.5",
          odds: -0.88,
          stake: 0.5
        }
      ]
    }
  });

  assert.equal(result.items[0].has_surebet, false);
  assert.equal(result.items[0].verification_status, "none");
  assert.equal(result.items[0].opportunity_id, "");
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
            handicap: [
              {
                id: "market-cmd",
                period: "FT",
                line: "0.5",
                outcomes: [
                  {
                    fixture_id: "fixture-cmd",
                    outcome_id: "fixture-cmd:hdp-ah:away-0-5",
                    outcome_name: "Away -0.5",
                    side: "away",
                    odds: 0.82,
                    collected_at: "2026-07-18T08:00:00Z",
                    is_surebet_leg: true,
                    is_candidate_leg: true
                  }
                ]
              }
            ],
            over_under: []
          }
        ]
      }
    ]
  };
}
