import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseJun88BtiSnapshot } from "@surebet/collector-shared";

async function main() {
  const htmlPath = path.resolve("../docs/lobbby/jun888/biti.html");
  const html = await readFile(htmlPath, "utf8");
  const snapshot = parseJun88BtiSnapshot(
    html,
    "https://prod20355-146486234.442hattrick.com/vi/asian-view/today/B%C3%B3ng-%C4%91%C3%A1"
  );

  console.log(JSON.stringify({
    count: snapshot.selections.length,
    sample: snapshot.selections.slice(0, 5)
  }, null, 2));

  if (snapshot.selections.length === 0) {
    throw new Error("BTI parser returned an empty snapshot.");
  }
}

main().catch((error) => {
  console.error("BTI parser test failed:", error);
  process.exit(1);
});

