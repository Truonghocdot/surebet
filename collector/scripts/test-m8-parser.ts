import { readFile } from "node:fs/promises";
import path from "node:path";
import { JSDOM } from "jsdom";
import { parseJun88M9BetSnapshot } from "@surebet/collector-shared";

async function main() {
  const htmlPath = path.resolve("../docs/lobbby/jun888/m8.html");
  const html = await readFile(htmlPath, "utf8");
  const snapshot = parseJun88M9BetSnapshot(
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
    throw new Error("M9Bet parser returned an empty snapshot.");
  }

  assertLeagueScopes(html, snapshot);
}

function assertLeagueScopes(
  html: string,
  snapshot: ReturnType<typeof parseJun88M9BetSnapshot>
) {
  const document = new JSDOM(html).window.document;
  const expectedByFixture = new Map<string, string>();

  for (const rowNode of Array.from(document.querySelectorAll("tr[oddsid]"))) {
    const fixtureID = rowNode.getAttribute("favid");
    const leagueName = precedingLeagueName(rowNode);
    if (fixtureID && leagueName) {
      expectedByFixture.set(fixtureID, leagueName);
    }
  }

  const mismatches = snapshot.selections.filter((selection) => {
    const expected = expectedByFixture.get(selection.fixtureId);
    return expected !== undefined && selection.leagueName !== expected;
  });
  if (mismatches.length > 0) {
    throw new Error(
      `M9Bet parser assigned ${mismatches.length} selection(s) to the wrong league: ${JSON.stringify(mismatches.slice(0, 2))}`
    );
  }
}

function precedingLeagueName(rowNode: Element) {
  const table = rowNode.closest("table");
  if (!table) {
    return "";
  }

  const entries = Array.from(table.querySelectorAll(".Span_titleleague, tr[oddsid]"));
  const rowIndex = entries.indexOf(rowNode);
  for (let index = rowIndex - 1; index >= 0; index -= 1) {
    if (entries[index].matches(".Span_titleleague")) {
      return textContent(entries[index]);
    }
  }

  return "";
}

function textContent(node: Element | null) {
  return node?.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

main().catch((error) => {
  console.error("M9Bet parser test failed:", error);
  process.exit(1);
});
