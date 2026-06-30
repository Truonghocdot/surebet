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
}

main().catch((error) => {
  console.error("8xbet incoming parser test failed:", error);
  process.exit(1);
});
