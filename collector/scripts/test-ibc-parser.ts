import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseJun88IbcSnapshot } from "@surebet/collector-shared";

async function main() {
  const htmlPath = path.resolve("../docs/lobbby/jun888/saba.html");
  const html = await readFile(htmlPath, "utf8");
  const snapshot = parseJun88IbcSnapshot(
    html,
    "https://g768ob.bpd3a3fn.com/NewIndex?lang=vn&WebSkinType=3"
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
    throw new Error("IBC parser returned an empty snapshot.");
  }
}

main().catch((error) => {
  console.error("IBC parser test failed:", error);
  process.exit(1);
});
