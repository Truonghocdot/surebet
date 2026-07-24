import assert from "node:assert/strict";
import test from "node:test";
import type { OpportunityBoard } from "@/features/dashboard/schemas/crm-schemas";
import {
  filterOpportunityBoardForRole,
  isOpportunityVisibleForRole
} from "./opportunity-visibility";

function opportunity(left: number, right: number) {
  return {
    legs: [
      { odds: left },
      { odds: right }
    ]
  } as Parameters<typeof isOpportunityVisibleForRole>[0];
}

test("admin sees only two-negative opportunities", () => {
  assert.equal(isOpportunityVisibleForRole(opportunity(-0.91, -0.88), "admin"), true);
  assert.equal(isOpportunityVisibleForRole(opportunity(-0.91, 0.88), "admin"), false);
});

test("super admin sees two-negative and mixed opportunities", () => {
  assert.equal(isOpportunityVisibleForRole(opportunity(-0.91, -0.88), "super_admin"), true);
  assert.equal(isOpportunityVisibleForRole(opportunity(-0.91, 0.88), "super_admin"), true);
});

test("removes mixed opportunity state from an admin board without removing the match", () => {
  const board: OpportunityBoard = {
    items: [{
      id: "fixture-a",
      opportunity_id: "opportunity-a",
      match_name: "Home vs Away",
      match_state: "live",
      has_surebet: true,
      odds_profile: "one_negative_one_positive",
      market_name: "hdp-ah",
      profit_percentage: 1.2,
      expected_return: 0.012,
      latest_collected_at: "2026-07-18T08:00:00Z",
      confirmed_at: "",
      expires_at: "2099-07-18T08:00:03Z",
      league_names: ["League"],
      verification_status: "candidate",
      valid_until: "",
      match_confidence: 1,
      match_ambiguous: false,
      sources: []
    }]
  };

  const adminBoard = filterOpportunityBoardForRole(board, "admin");
  assert.equal(adminBoard.items.length, 1);
  assert.equal(adminBoard.items[0].has_surebet, false);
  assert.equal(adminBoard.items[0].opportunity_id, "");

  const superAdminBoard = filterOpportunityBoardForRole(board, "super_admin");
  assert.equal(superAdminBoard, board);
  assert.equal(superAdminBoard.items[0].has_surebet, true);
});
