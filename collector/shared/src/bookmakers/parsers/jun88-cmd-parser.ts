import crypto from "node:crypto";
import { JSDOM } from "jsdom";
import type { OddsSelection, OddsSnapshot } from "../../contracts.js";

type MarketContext = {
  fixtureId: string;
  marketId: string;
  marketName: string;
  leagueName: string;
  line: string;
  homeTeam: string;
  awayTeam: string;
  drawLabel: string;
  matchState: "upcoming" | "live" | "finished" | "unknown";
};

export function parseJun88CmdSnapshot(
  html: string,
  pageUrl: string,
  collectorId = "jun88-cmd"
): OddsSnapshot {
  const dom = new JSDOM(html);
  const document = dom.window.document;
  const matchGroups = groupJun88MatchRows(document);
  const selections = matchGroups.flatMap((rows) => parseMatchGroup(rows));

  return {
    source: {
      collectorId,
      bookmakerId: "jun88",
      lobbyId: "cmd"
    },
    collectedAt: new Date().toISOString(),
    selections:
      selections.length > 0 || matchGroups.length > 0
        ? selections
        : parseFallbackMatches(document, pageUrl)
  };
}

function parseMatchGroup(rows: HTMLElement[]) {
  const baseRow = rows.find((row) => row.classList.contains("default-match")) ?? rows[0];
  const matchID = baseRow?.id.replace(/^R_/, "") || "";
  const leagueName = baseRow ? textContent(findPrecedingLeagueLabel(baseRow)) : "";
  const homeTeam =
    textContent(baseRow?.querySelector(`#ht_${matchID}`)) ||
    textContent(baseRow?.querySelector(".tableDiv-match-info__event div:first-child")) ||
    "";
  const awayTeam =
    textContent(baseRow?.querySelector(`#at_${matchID}`)) ||
    textContent(baseRow?.querySelector(".tableDiv-match-info__event div:nth-child(2)")) ||
    "";
  const drawLabel = textContent(baseRow?.querySelector(".drawcss")) || "Hòa";

  if (!isStandardJun88CmdFixture(leagueName, homeTeam, awayTeam)) {
    return [];
  }

  const fixtureId =
    baseRow?.getAttribute("groupid") ||
    stableFixtureId(`${leagueName}|${homeTeam}|${awayTeam}|${matchID}`);

  const selections = rows.flatMap((row) => {
    const fullTimeRows = Array.from(
      row.querySelectorAll(":scope > .col.row:not(.halfmatchStats)")
    ) as HTMLElement[];
    const halfTimeRows = Array.from(
      row.querySelectorAll(":scope > .col.row.halfmatchStats")
    ) as HTMLElement[];
    const matchState = detectCmdMatchState(row);

    return [
      ...fullTimeRows.flatMap((rowNode) =>
        parseMarketRow(rowNode, {
          fixtureId,
          leagueName,
          homeTeam,
          awayTeam,
          drawLabel,
          prefix: "FT",
          matchState
        })
      ),
      ...halfTimeRows.flatMap((rowNode) =>
        parseMarketRow(rowNode, {
          fixtureId,
          leagueName,
          homeTeam,
          awayTeam,
          drawLabel,
          prefix: "1H",
          matchState
        })
      )
    ];
  });

  return dedupeSelections(selections);
}

function findPrecedingLeagueLabel(matchNode: HTMLElement) {
  const scope = matchNode.closest(".tableDiv");
  if (!scope) {
    return null;
  }

  const entries = Array.from(scope.querySelectorAll(".league label, .match.default-match"));
  const matchIndex = entries.indexOf(matchNode);
  for (let index = matchIndex - 1; index >= 0; index -= 1) {
    if (entries[index].matches(".league label")) {
      return entries[index];
    }
  }

  return null;
}

function groupJun88MatchRows(document: Document) {
  const rows = Array.from(
    document.querySelectorAll(".match.default-match, .match.copy-match")
  ) as HTMLElement[];
  const groups = new Map<string, HTMLElement[]>();

  for (const row of rows) {
    const groupId = row.getAttribute("groupid") || row.id || stableFixtureId(textContent(row));
    const current = groups.get(groupId) ?? [];
    current.push(row);
    groups.set(groupId, current);
  }

  return Array.from(groups.values());
}

function parseMarketRow(
  rowNode: HTMLElement | null,
  options: {
    fixtureId: string;
    leagueName: string;
    homeTeam: string;
    awayTeam: string;
    drawLabel: string;
    prefix: string;
    matchState: "upcoming" | "live" | "finished" | "unknown";
  }
) {
  if (!rowNode) {
    return [];
  }

  return [
    ...Array.from(rowNode.querySelectorAll(".w-hdp .tableDiv-match-odds")).flatMap((node) =>
      parseHdpMarket(node as HTMLElement, {
        fixtureId: options.fixtureId,
        marketId: cmdMarketID(options.prefix, "handicap"),
        marketName: `${options.prefix} Handicap`,
        leagueName: options.leagueName,
        homeTeam: options.homeTeam,
        awayTeam: options.awayTeam,
        drawLabel: options.drawLabel,
        line: "",
        matchState: options.matchState
      })
    ),
    ...Array.from(rowNode.querySelectorAll(".w-ou .tableDiv-match-odds")).flatMap((node) =>
      parseOuMarket(node as HTMLElement, {
        fixtureId: options.fixtureId,
        marketId: cmdMarketID(options.prefix, "over_under"),
        marketName: `${options.prefix} Over/Under`,
        leagueName: options.leagueName,
        homeTeam: options.homeTeam,
        awayTeam: options.awayTeam,
        drawLabel: options.drawLabel,
        line: "",
        matchState: options.matchState
      })
    ),
    ...Array.from(rowNode.querySelectorAll(".col-45 .tableDiv-match-odds__X12detail")).flatMap((node) =>
      parseOneXTwoMarket(node as HTMLElement, {
        fixtureId: options.fixtureId,
        marketId: cmdMarketID(options.prefix, "one_x_two"),
        marketName: `${options.prefix} 1X2`,
        leagueName: options.leagueName,
        homeTeam: options.homeTeam,
        awayTeam: options.awayTeam,
        drawLabel: options.drawLabel,
        line: "",
        matchState: options.matchState
      })
    )
  ];
}

function parseHdpMarket(node: HTMLElement | null, base: MarketContext) {
  if (!node) {
    return [];
  }

  const line = textContent(node.querySelector("b")) || base.line;
  const buttons = Array.from(node.querySelectorAll(".tableDiv-match-odds__detail > a")) as HTMLElement[];
  const [homeButton, awayButton] = buttons;

  return [
    createSelection(homeButton, {
      ...base,
      line: normalizeHandicapLine(line, "home"),
      outcomeName: formatOutcome(base.homeTeam, normalizeHandicapLine(line, "home"))
    }),
    createSelection(awayButton, {
      ...base,
      line: normalizeHandicapLine(line, "away"),
      outcomeName: formatOutcome(base.awayTeam, normalizeHandicapLine(line, "away"))
    })
  ].filter((item): item is OddsSelection => item !== null);
}

function parseOuMarket(node: HTMLElement | null, base: MarketContext) {
  if (!node) {
    return [];
  }

  const line = textContent(node.querySelector("b")) || base.line;
  const buttons = Array.from(node.querySelectorAll(".tableDiv-match-odds__detail a")) as HTMLElement[];
  const [overButton, underButton] = buttons;

  return [
    createSelection(overButton, {
      ...base,
      line,
      outcomeName: formatOutcome("Over", line)
    }),
    createSelection(underButton, {
      ...base,
      line,
      outcomeName: formatOutcome("Under", line)
    })
  ].filter((item): item is OddsSelection => item !== null);
}

function parseOneXTwoMarket(node: HTMLElement | null, base: MarketContext) {
  if (!node) {
    return [];
  }

  const buttons = Array.from(node.querySelectorAll("a")) as HTMLElement[];
  const [homeButton, awayButton, drawButton] = buttons;

  return [
    createSelection(homeButton, {
      ...base,
      outcomeName: base.homeTeam
    }),
    createSelection(awayButton, {
      ...base,
      outcomeName: base.awayTeam
    }),
    createSelection(drawButton, {
      ...base,
      outcomeName: base.drawLabel
    })
  ].filter((item): item is OddsSelection => item !== null);
}

function createSelection(
  node: HTMLElement | undefined,
  context: MarketContext & { outcomeName: string }
): OddsSelection | null {
  if (!node) {
    return null;
  }

  const oddsValue = parseOddsValue(textContent(node));

  return {
    fixtureId: context.fixtureId,
    homeTeam: context.homeTeam,
    awayTeam: context.awayTeam,
    leagueName: context.leagueName,
    matchState: context.matchState,
    marketId: context.marketId,
    outcomeId: `${context.fixtureId}:${context.marketId}:${normalizeToken(
      context.outcomeName
    )}`,
    outcomeName: context.outcomeName,
    odds: Number.isFinite(oddsValue) ? oddsValue : 0,
    availableStake: 0,
    suspended: !Number.isFinite(oddsValue),
  };
}

function detectCmdMatchState(matchNode: HTMLElement) {
  const combined = `${matchNode.className} ${textContent(matchNode)}`;
  if (/running|1h|2h|ht|\\d{1,2}'/i.test(combined)) {
    return "live" as const;
  }
  if (/finished|ended|ft\\b/i.test(combined)) {
    return "finished" as const;
  }
  return "unknown" as const;
}

function parseFallbackMatches(document: Document, pageUrl: string) {
  const matches = Array.from(document.querySelectorAll(".match"));

  return matches.flatMap((matchNode, index) => {
    const text = textContent(matchNode);
    if (!text) {
      return [];
    }

    return [
      {
        fixtureId: stableFixtureId(`${pageUrl}|${index}|${text}`),
        marketId: "raw-match",
        outcomeId: stableFixtureId(`raw-match|${index}|${text}`),
        outcomeName: text.slice(0, 80),
        odds: 0,
        availableStake: 0,
        suspended: true
      }
    ];
  });
}

function normalizeHandicapLine(line: string, side: "home" | "away") {
  if (!line) {
    return "";
  }

  if (side === "home") {
    return line.startsWith("-") ? line : `+${line}`;
  }

  return line.startsWith("-") ? line.slice(1) : `-${line}`;
}

function cmdMarketID(prefix: string, kind: "handicap" | "over_under" | "one_x_two") {
  const normalizedPrefix = prefix.trim().toUpperCase();
  const isFirstHalf = normalizedPrefix === "1H";

  switch (kind) {
    case "handicap":
      return isFirstHalf ? "hdp-ah-1st" : "hdp-ah";
    case "over_under":
      return isFirstHalf ? "o-u-ou-1st" : "o-u-ou";
    case "one_x_two":
      return isFirstHalf ? "1x2-1st" : "1x2";
    default:
      return normalizeToken(`${prefix}-${kind}`);
  }
}

function formatOutcome(name: string, line: string) {
  return [name, line].filter(Boolean).join(" ").trim();
}

function parseOddsValue(value: string) {
  return Number.parseFloat(value.replace(/[^\d./-]+/g, ""));
}

function dedupeSelections(items: OddsSelection[]) {
  const byOutcomeId = new Map<string, OddsSelection>();
  for (const item of items) {
    byOutcomeId.set(item.outcomeId, item);
  }
  return Array.from(byOutcomeId.values());
}

function stableFixtureId(input: string) {
  return crypto.createHash("sha1").update(input).digest("hex");
}

function normalizeToken(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

export function isStandardJun88CmdFixture(
  leagueName: string,
  homeTeam: string,
  awayTeam: string
) {
  if (!homeTeam.trim() || !awayTeam.trim()) {
    return false;
  }

  const league = filterFixtureText(leagueName);
  const participants = filterFixtureText(`${homeTeam} ${awayTeam}`);
  if (
    /\b(corners?|corner kicks?|bookings?|cards?|e\s?soccer|e\s?football|exotic|specials?|virtual)\b/.test(
      league
    ) ||
    /\bsingle team\b/.test(league) ||
    /\bspecific\s+\d+\s+mins?\b/.test(league) ||
    /\b(no of corners?|\d+(st|nd|rd|th) corner|\d{1,2}\s+\d{2}\s+\d{1,2}\s+\d{2})\b/.test(
      participants
    ) ||
    /\b(over|under)\s*$/.test(filterFixtureText(homeTeam)) ||
    /\b(over|under)\s*$/.test(filterFixtureText(awayTeam))
  ) {
    return false;
  }

  return true;
}

function filterFixtureText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function textContent(node: Element | null | undefined) {
  return node?.textContent?.replace(/\s+/g, " ").trim() ?? "";
}
