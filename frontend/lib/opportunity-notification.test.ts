import assert from "node:assert/strict";
import test from "node:test";
import {
  browserNotificationBody,
  buildOpportunityNotificationDetails
} from "@/lib/opportunity-notification";

test("formats a handicap opportunity like the dashboard list", () => {
  const details = buildOpportunityNotificationDetails({
    fixture_id: "Sydney Uni SFC U23|Northern Tigers U23",
    market_name: "hdp-ah",
    legs: [{
      bookmaker_id: "8xbet",
      lobby_id: "default",
      outcome_name: "Sydney Uni SFC U23 +0",
      odds: 0.55
    }, {
      bookmaker_id: "jun88",
      lobby_id: "cmd",
      outcome_name: "Northern Tigers U23 -0",
      odds: -0.83
    }]
  });

  assert.equal(details.matchName, "Sydney Uni SFC U23 vs Northern Tigers U23");
  assert.equal(details.marketLabel, "Kèo chấp - Toàn trận");
  assert.deepEqual(details.legs, [{
    selectionLabel: "Sydney Uni SFC U23 +0",
    sourceLabel: "8xbet",
    odds: 0.55
  }, {
    selectionLabel: "Northern Tigers U23 -0",
    sourceLabel: "CMD",
    odds: -0.83
  }]);
  assert.match(browserNotificationBody({ ...details, profitPercentage: 3.25 }), /Lợi nhuận \+3\.25%/);
});

test("translates over-under legs and first-half market", () => {
  const details = buildOpportunityNotificationDetails({
    fixture_id: "Home vs Away",
    market_name: "o-u-ou-1st",
    legs: [{
      bookmaker_id: "8xbet",
      lobby_id: "default",
      outcome_name: "Over 3.5",
      odds: -0.9
    }, {
      bookmaker_id: "jun88",
      lobby_id: "cmd",
      outcome_name: "Under 3.5",
      odds: 0.82
    }]
  });

  assert.equal(details.marketLabel, "Tài xỉu - Hiệp 1");
  assert.deepEqual(details.legs.map((leg) => leg.selectionLabel), ["Tài 3.5", "Xỉu 3.5"]);
});
