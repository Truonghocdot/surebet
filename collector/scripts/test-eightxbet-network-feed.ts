import assert from "node:assert/strict";
import {
  buildEightXBetNetworkFixtureSnapshot,
  parseEightXBetOddsDiffFrame
} from "@surebet/collector-shared";

const occurredAt = "2026-07-16T21:39:09.520Z";
const snapshot = buildEightXBetNetworkFixtureSnapshot({
  occurredAt,
  metadata: {
    fixtureId: "4824992",
    homeTeam: "Home FC",
    awayTeam: "Away FC",
    leagueName: "League",
    eventStartAt: "2026-07-16T20:00:00.000Z"
  },
  markets: {
    ah: [
      { k: "-0.5", h: "0.90", a: "1.25" },
      { k: "+1", h: "0.88" }
    ],
    ah_1st: [{ k: "0", h: "1.14", a: "0.91" }],
    ou: [{ k: "3/3.5", ov: "1.20", ud: "0.84" }],
    ou_1st: [{ k: "1", ov: "0.95", ud: "1.10" }]
  }
});

assert.equal(snapshot.selections.length, 8, "only complete two-sided lines should be emitted");
assert.deepEqual(
  snapshot.selections.map((item) => [item.marketId, item.outcomeName, item.odds]),
  [
    ["hdp-ah", "Home FC -0.5", 0.9],
    ["hdp-ah", "Away FC +0.5", -0.8],
    ["hdp-ah-1st", "Home FC +0", -0.88],
    ["hdp-ah-1st", "Away FC -0", 0.91],
    ["o-u-ou", "Over 3/3.5", -0.83],
    ["o-u-ou", "Under 3/3.5", 0.84],
    ["o-u-ou-1st", "Over 1", 0.95],
    ["o-u-ou-1st", "Under 1", -0.91]
  ]
);

const frame = [
  "MESSAGE",
  "destination:/topic/odds-diff/match/4824992/pd1/MOBILE",
  "content-type:application/json",
  "",
  JSON.stringify({
    iid: 4824992,
    sendType: "UPDATE",
    market: { ah: [{ k: "-0.5", h: "0.91", a: "0.81" }], exotic: { h: "2.0" } },
    removeMarket: ["ou"],
    nwTimestamp: "1784237949520"
  }) + "\0"
].join("\n");
const parsed = parseEightXBetOddsDiffFrame(frame);
assert(parsed);
assert.equal(parsed.fixtureId, "4824992");
assert.equal(parsed.full, false);
assert.deepEqual(parsed.removedMarkets, ["ou"]);
assert.ok("ah" in parsed.markets);

console.log("8xbet network feed parser tests passed");
