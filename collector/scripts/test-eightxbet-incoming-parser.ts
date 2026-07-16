import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  parseEightXBetExhaustiveSnapshot,
  parseEightXBetIncomingSnapshot
} from "@surebet/collector-shared";

async function main() {
  const incomingPlayPath = path.resolve("../docs/lobbby/8xbet/incomingplay.html");
  const incomingPlayHTML = await readFile(incomingPlayPath, "utf8");
  const snapshot = parseEightXBetIncomingSnapshot(
    incomingPlayHTML,
    "https://8x4455.com/sportEvents/incoming/football?hour=6"
  );

  console.log(
    JSON.stringify(
      {
        count: snapshot.selections.length,
        sample: snapshot.selections.slice(0, 5)
      },
      null,
      2
    )
  );

  if (snapshot.selections.length === 0) {
    throw new Error("8xbet incoming parser returned an empty snapshot.");
  }

  if (snapshot.selections.some((selection) => selection.matchState !== "upcoming")) {
    throw new Error("8xbet incomingplay parser should classify scheduled fixtures as upcoming.");
  }
  if (snapshot.selections.some((selection) => !selection.eventStartAt)) {
    throw new Error("8xbet incomingplay parser should extract eventStartAt from stage labels.");
  }
  assertNoPartialMarkets(snapshot, "incomingplay");
  assertNoExoticMarkets(snapshot, "incomingplay");

  const firstHalfHandicap = snapshot.selections.find(
    (selection) => selection.marketId === "hdp-ah-1st"
  );
  if (!firstHalfHandicap) {
    throw new Error("8xbet parser should normalize first-half handicap market ids.");
  }

  const inplayPath = path.resolve("../docs/lobbby/8xbet/inplay.html");
  const inplayHTML = await readFile(inplayPath, "utf8");
  const inplaySnapshot = parseEightXBetIncomingSnapshot(
    inplayHTML,
    "https://8x4455.com/sportEvents/inplay/football"
  );
  const nonLiveSelection = inplaySnapshot.selections.find(
    (selection) => selection.matchState !== "live"
  );
  if (nonLiveSelection) {
    throw new Error(
      `8xbet inplay parser should force live match state, got ${nonLiveSelection.matchState}`
    );
  }
  assertNoPartialMarkets(inplaySnapshot, "inplay");
  assertNoExoticMarkets(inplaySnapshot, "inplay");

  const exhaustivePath = path.resolve("../docs/lobbby/8xbet/exhautscontent.html");
  const exhaustiveHTML = await readFile(exhaustivePath, "utf8");
  const exhaustiveSnapshot = parseEightXBetExhaustiveSnapshot(
    exhaustiveHTML,
    "https://8x4455.com/sportEvents/inplay/football",
    "8xbet",
    "4811846"
  );
  if (exhaustiveSnapshot.selections.length !== 8) {
    throw new Error(
      `8xbet exhaustive parser should keep exactly 8 supported selections, got ${exhaustiveSnapshot.selections.length}`
    );
  }
  if (exhaustiveSnapshot.selections.some((selection) => selection.matchState !== "live")) {
    throw new Error("8xbet exhaustive parser should classify selections as live.");
  }
  const exhaustiveMarketIDs = [...new Set(exhaustiveSnapshot.selections.map((selection) => selection.marketId))];
  const expectedMarkets = new Set([
    "hdp-ah",
    "hdp-ah-1st",
    "o-u-ou",
    "o-u-ou-1st"
  ]);
  for (const marketID of exhaustiveMarketIDs) {
    if (!expectedMarkets.has(marketID)) {
      throw new Error(`8xbet exhaustive parser should ignore unsupported market ${marketID}`);
    }
  }

  const stageFixture = parseEightXBetIncomingSnapshot(
    `
      <div data-testid="v4-sport-asia-simple-handicap-unit-1">
        <div data-testid="simple-handicap-odds-header"><span>Club Friendlies</span></div>
        <div data-testid="simple-handicap-layout-football-999">
          <div data-testid="simple-game-stage"><small class="text-text-2">Upcoming</small></div>
          <div class="flex w-full flex-row justify-between pb-0 pt-2">
            <div>
              <small class="text-text-2">FC Andorra</small>
              <small class="text-text-2">Millwall FC</small>
            </div>
            <div data-testid="sport-simple-asia-odds-layout">
              <button data-testid="oddsBtn-1|1|ou|ov">
                <small>2.5</small>
                <small>-0.95</small>
              </button>
              <button data-testid="oddsBtn-1|1|ou|ud">
                <small>2.5</small>
                <small>-0.99</small>
              </button>
            </div>
          </div>
          <div data-testid="sport-hover-popover">Tài / Xỉu</div>
        </div>
      </div>
    `,
    "https://8x282.com/sportEvents/incoming/football?hour=6"
  );
  const stageSelection = stageFixture.selections[0];
  if (!stageSelection) {
    throw new Error("8xbet parser should extract selections from synthetic stage fixture.");
  }
  if (stageSelection.homeTeam !== "FC Andorra" || stageSelection.awayTeam !== "Millwall FC") {
    throw new Error(
      `8xbet parser should ignore stage labels when reading teams, got ${stageSelection.homeTeam} vs ${stageSelection.awayTeam}`
    );
  }
}

function assertNoPartialMarkets(
  snapshot: ReturnType<typeof parseEightXBetIncomingSnapshot>,
  label: string
) {
  const counts = new Map<string, number>();
  for (const selection of snapshot.selections) {
    const marketKey = `${selection.fixtureId}|${selection.marketId}`;
    counts.set(marketKey, (counts.get(marketKey) ?? 0) + 1);
  }

  for (const [marketKey, count] of counts.entries()) {
    const [, marketId] = marketKey.split("|");
    const expected = marketId.includes("1x2") ? 3 : 2;
    if (count !== expected) {
      throw new Error(
        `8xbet ${label} parser should not emit partial markets, got ${count}/${expected} for ${marketKey}`
      );
    }
  }
}

function assertNoExoticMarkets(
  snapshot: ReturnType<typeof parseEightXBetIncomingSnapshot>,
  label: string
) {
  const unsupported = snapshot.selections.filter((selection) =>
    selection.marketId.includes("h-ou") ||
    selection.marketId.includes("a-ou") ||
    selection.marketId.includes("btts")
  );

  if (unsupported.length > 0) {
    throw new Error(
      `8xbet ${label} parser should drop exotic markets, got ${unsupported
        .map((selection) => selection.marketId)
        .join(", ")}`
    );
  }
}

main().catch((error) => {
  console.error("8xbet incoming parser test failed:", error);
  process.exit(1);
});
