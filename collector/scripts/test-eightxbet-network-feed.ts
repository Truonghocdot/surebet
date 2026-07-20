import assert from "node:assert/strict";
import {
  EightXBetNetworkFeed,
  buildEightXBetNetworkFixtureSnapshot,
  normalizeIndonesianToMalayOdds,
  parseEightXBetOddsDiffFrame,
  parseEightXBetFullMatchPayload,
  parseEightXBetStandardFixtures
} from "@surebet/collector-shared";
import type { OddsDelta } from "@surebet/collector-shared";

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
assert.equal(normalizeIndonesianToMalayOdds(0.91), 0.91);
assert.equal(normalizeIndonesianToMalayOdds(1.13), -0.88);
assert.equal(snapshot.selections[1].rawOdds, 1.25);
assert.equal(snapshot.selections[1].oddsFormat, "indonesian");
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
assert.equal(parsed.priceDisplay, "pd1");
assert.equal(parsed.destination, "/topic/odds-diff/match/4824992/pd1/MOBILE");

const fullMatch = parseEightXBetFullMatchPayload({
  code: 0,
  time: 1784236835159,
  nwTimestamp: 1784237949520,
  data: {
    data: {
      iid: 4824992,
      home: { name: "Home FC" },
      away: { name: "Away FC" },
      tnName: "League",
      market: { ah: [{ k: "-0.5", h: "0.91", a: "1.13" }] }
    }
  }
});
assert(fullMatch);
assert.equal(fullMatch.fixtureId, "4824992");
assert.equal(fullMatch.sourceEventId, "1784237949520");
assert.equal(fullMatch.occurredAt, "2026-07-16T21:39:09.520Z");

const metadataPayload = {
  data: {
    tournaments: [
      {
        name: "League",
        matches: [
          {
            iid: 4824992,
            inplay: true,
            home: { name: "Home FC" },
            away: { name: "Away FC" }
          }
        ]
      },
      {
        name: "Brazil Serie A - Corners",
        matches: [
          {
            iid: 1002,
            inplay: true,
            home: { name: "Bahia EC BA (No.of Corners)" },
            away: { name: "Chapecoense SC (No.of Corners)" }
          }
        ]
      },
      {
        name: "Brazil Serie A - Single Team Over/Under",
        matches: [
          {
            iid: 1003,
            inplay: true,
            home: { name: "Bahia EC BA - Over" },
            away: { name: "Bahia EC BA - Under" }
          }
        ]
      },
      {
        name: "Brazil Serie A - Specific 15 Mins",
        matches: [
          {
            iid: 1004,
            inplay: true,
            home: { name: "Bahia EC BA (00:00-15:00)" },
            away: { name: "Chapecoense SC (00:00-15:00)" }
          }
        ]
      },
      {
        name: "Esoccer Battle - 8 Mins Play",
        matches: [
          {
            iid: 1005,
            inplay: true,
            home: { name: "England (A1ose)" },
            away: { name: "Argentina (R0ge)" }
          }
        ]
      }
    ]
  }
};
assert.deepEqual(
  parseEightXBetStandardFixtures(metadataPayload).map((item) =>
    String((item as Record<string, unknown>).iid)
  ),
  ["4824992"],
  "metadata must retain standard football and drop exotic fixtures"
);

class FakeEmitter {
  private readonly listeners = new Map<string, Set<(value: any) => void>>();

  on(event: string, listener: (value: any) => void) {
    const current = this.listeners.get(event) ?? new Set();
    current.add(listener);
    this.listeners.set(event, current);
  }

  off(event: string, listener: (value: any) => void) {
    this.listeners.get(event)?.delete(listener);
  }

  emit(event: string, value: any) {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(value);
    }
  }
}

class FakeSocket extends FakeEmitter {
  url() {
    return "wss://gw-nwwss.example/websocket/ws";
  }
}

function stompFrame(sendType: "INIT" | "UPDATE", body: Record<string, unknown>) {
  return [
    "MESSAGE",
    "destination:/topic/odds-diff/match/4824992/pd1/MOBILE",
    "content-type:application/json",
    "",
    JSON.stringify({
      iid: 4824992,
      sendType,
      nwTimestamp: "1784237949520",
      ...body
    }) + "\0"
  ].join("\n");
}

function metadataResponse(payload: unknown) {
  return {
    url: () =>
      "https://gw-nwapi.example/product/business/sport/tournament/info?sid=1&inplay=true",
    json: async () => payload
  };
}

async function testMarketDeltaDelivery() {
  const feed = new EightXBetNetworkFeed("8xbet");
  const page = new FakeEmitter();
  const socket = new FakeSocket();
  const delivered: OddsDelta[][] = [];
  feed.attach(page as any);
  feed.activate(snapshot, async (deltas) => {
    delivered.push(deltas);
  });
  page.emit("websocket", socket);

  socket.emit("framereceived", {
    payload: stompFrame("INIT", {
      market: {
        ah: [{ k: "-0.5", h: "0.90", a: "1.25" }],
        ah_1st: [{ k: "0", h: "1.14", a: "0.91" }],
        ou: [{ k: "3/3.5", ov: "1.20", ud: "0.84" }],
        ou_1st: [{ k: "1", ov: "0.95", ud: "1.10" }]
      }
    })
  });
  await feed.flush();
  assert.equal(delivered.length, 0, "an unchanged INIT must not emit deltas");
  assert.deepEqual(feed.oddsFormatDiagnostics(), {
    destination: "/topic/odds-diff/match/4824992/pd1/MOBILE",
    priceDisplay: "pd1",
    rawOddsSamples: [0.9, 1.25, 1.14, 0.91, 1.2, 0.84, 0.95, 1.1],
    observationCount: 1,
    healthy: true,
    unhealthyReason: ""
  });

  socket.emit("framereceived", {
    payload: stompFrame("UPDATE", {
      market: {
        ah: [{ k: "-0.5", h: "0.91", a: "1.25" }]
      }
    })
  });
  await feed.flush();
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].length, 1);
  assert.equal(delivered[0][0].marketId, "hdp-ah");
  assert.equal(delivered[0][0].op, "upsert");

  socket.emit("framereceived", {
    payload: stompFrame("UPDATE", {
      removeMarket: ["ou"]
    })
  });
  await feed.flush();
  assert.equal(delivered.length, 2);
  assert.equal(delivered[1].length, 2);
  assert.ok(delivered[1].every((delta) => delta.marketId === "o-u-ou"));
  assert.ok(delivered[1].every((delta) => delta.op === "remove"));

  page.emit("response", metadataResponse({ code: 0, ...metadataPayload }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await feed.flush();
  assert.deepEqual(feed.activeFixtureIds(), ["4824992"]);
  assert.match(
    feed.hardConfirmationURL("4824992"),
    /\/product\/business\/sport\/inplay\/match\?.*iid=4824992/
  );
  assert.deepEqual(feed.coverageStats(), {
    metadataFixtures: 1,
    decodedFixtures: 1,
    fixturesWithQuotes: 1,
    pendingFixtures: 0,
    filteredFixtures: 4
  });
  assert.equal(delivered.length, 2, "unchanged metadata must not emit quote deltas");

  page.emit("response", metadataResponse({ code: 500, data: { tournaments: [] } }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(
    feed.activeFixtureIds(),
    ["4824992"],
    "an invalid metadata response must not retire active fixtures"
  );

  page.emit(
    "response",
    metadataResponse({
      code: 0,
      data: { tournaments: [] }
    })
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  await feed.flush();
  assert.deepEqual(feed.activeFixtureIds(), []);
  assert.equal(delivered.length, 3);
  assert.equal(delivered[2].length, 6, "metadata retirement must remove remaining quotes");
  assert.ok(delivered[2].every((delta) => delta.op === "remove"));
}

async function testOddsFormatGateRejectsUnexpectedFeed() {
  const unsupportedFeed = new EightXBetNetworkFeed("8xbet");
  const unsupportedPage = new FakeEmitter();
  const unsupportedSocket = new FakeSocket();
  unsupportedFeed.attach(unsupportedPage as any);
  unsupportedPage.emit("websocket", unsupportedSocket);
  unsupportedSocket.emit("framereceived", {
    payload: stompFrame("UPDATE", {
      market: { ah: [{ k: "-0.5", h: "0.91", a: "1.13" }] }
    }).replace("/pd1/", "/pd2/")
  });
  assert.equal(unsupportedFeed.oddsFormatDiagnostics().healthy, false);
  assert.match(
    unsupportedFeed.oddsFormatDiagnostics().unhealthyReason,
    /unexpected odds destination pd2/
  );

  const negativeFeed = new EightXBetNetworkFeed("8xbet");
  const negativePage = new FakeEmitter();
  const negativeSocket = new FakeSocket();
  negativeFeed.attach(negativePage as any);
  negativePage.emit("websocket", negativeSocket);
  negativeSocket.emit("framereceived", {
    payload: stompFrame("UPDATE", {
      market: { ah: [{ k: "-0.5", h: "-0.88", a: "0.91" }] }
    })
  });
  assert.equal(negativeFeed.oddsFormatDiagnostics().healthy, false);
  assert.match(
    negativeFeed.oddsFormatDiagnostics().unhealthyReason,
    /non-positive raw odds/
  );
}

Promise.all([
  testMarketDeltaDelivery(),
  testOddsFormatGateRejectsUnexpectedFeed()
])
  .then(() => console.log("8xbet network feed parser tests passed"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
