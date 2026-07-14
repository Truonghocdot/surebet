import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseEightXBetIncomingSnapshot } from "@surebet/collector-shared";

async function main() {
  const htmlPath = path.resolve("../docs/lobbby/8xbet/incoming6h.html");
  const html = await readFile(htmlPath, "utf8");
  const snapshot = parseEightXBetIncomingSnapshot(
    html,
    "https://8x282.com/sportEvents/incoming/football?hour=6"
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

  const awayHandicap = snapshot.selections.find(
    (selection) =>
      selection.fixtureId === "4658513" &&
      selection.marketId === "cu-o-c-cha-p-ah" &&
      selection.outcomeName.includes("RoPS Rovaniemi")
  );
  if (!awayHandicap?.outcomeName.includes("-1/1.5")) {
    throw new Error(
      `8xbet incoming parser should preserve away handicap sign, got ${awayHandicap?.outcomeName ?? "missing"}`
    );
  }

  const firstHalfHandicap = snapshot.selections.find(
    (selection) =>
      selection.fixtureId === "4658513" && selection.marketId === "cu-o-c-cha-p-ah-1st"
  );
  if (!firstHalfHandicap) {
    throw new Error("8xbet parser should keep marketCode in first-half market ids.");
  }

  const inplaySnapshot = parseEightXBetIncomingSnapshot(
    html,
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

main().catch((error) => {
  console.error("8xbet incoming parser test failed:", error);
  process.exit(1);
});
