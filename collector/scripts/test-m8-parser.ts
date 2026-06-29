import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseJun88M8Snapshot } from "@surebet/collector-shared";

async function main() {
  const htmlPath = path.resolve("../docs/lobbby/jun888/m8.html");
  const html = await readFile(htmlPath, "utf8");
  const snapshot = parseJun88M8Snapshot(
    html,
    "https://bxhg006d.m9ongm9.com/Panel/PB.aspx?ot=t"
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
    throw new Error("M8 parser returned an empty snapshot.");
  }
}

main().catch((error) => {
  console.error("M8 parser test failed:", error);
  process.exit(1);
});
