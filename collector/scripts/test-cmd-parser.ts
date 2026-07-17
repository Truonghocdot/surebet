import { readFile } from "node:fs/promises";
import path from "node:path";
import { JSDOM } from "jsdom";
import {
  isStandardJun88CmdFixture,
  parseJun88CmdSnapshot
} from "@surebet/collector-shared";

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

  assertLeagueScopes(html, snapshot);
  assertStandardFixtureFilter(snapshot);
}

function assertStandardFixtureFilter(
  snapshot: ReturnType<typeof parseJun88CmdSnapshot>
) {
  const rejected = [
    ["BRAZIL SERIE A - CORNERS", "Bahia (No.of Corners)", "Chapecoense (No.of Corners)"],
    ["BRAZIL SERIE A - SINGLE TEAM OVER/UNDER", "Bahia - Over", "Bahia - Under"],
    ["BRAZIL SERIE A - SPECIFIC 15 MINS", "Bahia (00:00-15:00)", "Chapecoense (00:00-15:00)"],
    ["ESOCCER BATTLE - 8 MINS PLAY", "England (A1ose)", "Argentina (R0ge)"]
  ];
  for (const [league, home, away] of rejected) {
    if (isStandardJun88CmdFixture(league, home, away)) {
      throw new Error(`CMD exotic fixture was accepted: ${league}`);
    }
  }
  if (!isStandardJun88CmdFixture("BRAZIL SERIE B", "America Mineiro", "Ceara CE")) {
    throw new Error("CMD standard football fixture was rejected.");
  }

  const leaked = snapshot.selections.filter(
    (selection) =>
      !isStandardJun88CmdFixture(
        selection.leagueName ?? "",
        selection.homeTeam ?? "",
        selection.awayTeam ?? ""
      )
  );
  if (leaked.length > 0) {
    throw new Error(`CMD parser leaked ${leaked.length} exotic selection(s).`);
  }
}

function assertLeagueScopes(
  html: string,
  snapshot: ReturnType<typeof parseJun88CmdSnapshot>
) {
  const document = new JSDOM(html).window.document;
  const expectedByFixture = new Map<string, string>();

  for (const matchNode of Array.from(document.querySelectorAll(".match.default-match"))) {
    const fixtureID = matchNode.getAttribute("groupid");
    const leagueName = precedingLeagueName(matchNode);
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
      `CMD parser assigned ${mismatches.length} selection(s) to the wrong league: ${JSON.stringify(mismatches.slice(0, 2))}`
    );
  }
}

function precedingLeagueName(matchNode: Element) {
  const scope = matchNode.closest(".tableDiv");
  if (!scope) {
    return "";
  }

  const entries = Array.from(scope.querySelectorAll(".league label, .match.default-match"));
  const matchIndex = entries.indexOf(matchNode);
  for (let index = matchIndex - 1; index >= 0; index -= 1) {
    if (entries[index].matches(".league label")) {
      return textContent(entries[index]);
    }
  }

  return "";
}

function textContent(node: Element | null) {
  return node?.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

main().catch((error) => {
  console.error("CMD parser test failed:", error);
  process.exit(1);
});
