import assert from "node:assert/strict";
import test from "node:test";
import { isOpportunityVisibleForRole } from "./opportunity-visibility";

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
