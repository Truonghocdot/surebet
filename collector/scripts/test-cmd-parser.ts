import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseJun88CmdSnapshot } from "@surebet/collector-shared";

async function main() {
  const htmlPath = path.resolve("../docs/lobbby/jun888/cmd.html");
  const html = await readFile(htmlPath, "utf8");
  const snapshot = parseJun88CmdSnapshot(
    html,
    "https://ss159.6688867.com/BasePage/Content.aspx?m1=Today&sports=S_"
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
    throw new Error("CMD parser returned an empty snapshot.");
  }
}

main().catch((error) => {
  console.error("CMD parser test failed:", error);
  process.exit(1);
});
