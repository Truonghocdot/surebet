import assert from "node:assert/strict";
import test from "node:test";
import type { CurrentOpportunityBoardItem } from "@/lib/opportunity-board";
import { createOpportunityBoardStabilizer } from "@/lib/opportunity-board-stability";

test("carries the last complete board through a brief bootstrap collapse", () => {
  const stabilize = createOpportunityBoardStabilizer({
    collapseGraceMs: 10_000,
    idleResetMs: 30_000
  });
  const complete = Array.from({ length: 10 }, (_, index) => fixture(index, true));

  assert.equal(stabilize(complete, 1_000).length, 10);
  const transient = stabilize([], 2_000);
  assert.equal(transient.length, 10);
  assert.ok(transient.every((item) => !item.has_surebet));
  assert.ok(transient.every((item) =>
    item.sources.every((source) =>
      source.handicap.every((market) =>
        market.outcomes.every((outcome) => outcome.is_stale && outcome.odds === 0)
      )
    )
  ));
  assert.equal(stabilize([], 11_999).length, 10);
  assert.deepEqual(stabilize([], 12_000), []);
});

test("accepts normal changes, recovery, and an empty board after inactivity", () => {
  const stabilize = createOpportunityBoardStabilizer({
    collapseGraceMs: 10_000,
    idleResetMs: 30_000
  });
  const complete = Array.from({ length: 10 }, (_, index) => fixture(index));

  assert.equal(stabilize(complete, 1_000).length, 10);
  assert.equal(stabilize(complete.slice(0, 8), 2_000).length, 8);
  assert.equal(stabilize(complete.slice(0, 2), 3_000).length, 8);
  assert.equal(stabilize(complete, 4_000).length, 10);
  assert.deepEqual(stabilize([], 40_001), []);
});

function fixture(index: number, hasSurebet = false): CurrentOpportunityBoardItem {
  return {
    id: `fixture-${index}`,
    opportunity_id: hasSurebet ? `opportunity-${index}` : "",
    match_name: `Home ${index} vs Away ${index}`,
    match_state: "live",
    market_name: hasSurebet ? "hdp-ah" : "",
    profit_percentage: hasSurebet ? 2 : 0,
    expected_return: hasSurebet ? 0.02 : 0,
    odds_profile: hasSurebet ? "two_negative" : "unknown",
    latest_collected_at: "2026-07-25T15:00:00Z",
    confirmed_at: "",
    expires_at: "",
    league_names: ["League"],
    has_surebet: hasSurebet,
    verification_status: hasSurebet ? "candidate" : "none",
    valid_until: "",
    match_confidence: hasSurebet ? 1 : 0,
    match_ambiguous: false,
    sources: [{
      id: `8xbet-default-${index}`,
      bookmaker_id: "8xbet",
      lobby_id: "default",
      latest_collected_at: "2026-07-25T15:00:00Z",
      handicap: [{
        id: `market-${index}`,
        period: "FT",
        line: "0.5",
        outcomes: [{
          fixture_id: `fixture-${index}`,
          outcome_id: `home-${index}`,
          outcome_name: `Home ${index} -0.5`,
          side: "home",
          odds: -0.8,
          collected_at: "2026-07-25T15:00:00Z",
          is_stale: false,
          is_surebet_leg: hasSurebet,
          is_candidate_leg: hasSurebet
        }, {
          fixture_id: `fixture-${index}`,
          outcome_id: `away-${index}`,
          outcome_name: `Away ${index} +0.5`,
          side: "away",
          odds: 0.75,
          collected_at: "2026-07-25T15:00:00Z",
          is_stale: false,
          is_surebet_leg: false,
          is_candidate_leg: false
        }]
      }],
      over_under: []
    }]
  };
}
