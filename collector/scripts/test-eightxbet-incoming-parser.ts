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
      selection.marketId === "cu-o-c-cha-p-cu-o-c-cha-p" &&
      selection.outcomeName.includes("RoPS Rovaniemi")
  );
  if (!awayHandicap?.outcomeName.includes("-1/1.5")) {
    throw new Error(
      `8xbet incoming parser should preserve away handicap sign, got ${awayHandicap?.outcomeName ?? "missing"}`
    );
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
}

main().catch((error) => {
  console.error("8xbet incoming parser test failed:", error);
  process.exit(1);
});
