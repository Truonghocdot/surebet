import crypto from "node:crypto";
import { JSDOM } from "jsdom";
import type { OddsSelection, OddsSnapshot } from "../../contracts.js";

type MarketContext = {
  fixtureId: string;
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
  const selections = Array.from(document.querySelectorAll(".match.default-match"))
    .flatMap((matchNode) => parseMatch(matchNode as HTMLElement));

  return {
    source: {
      collectorId,
      bookmakerId: "jun88",
      lobbyId: "cmd"
    },
    collectedAt: new Date().toISOString(),
    selections:
      selections.length > 0 ? selections : parseFallbackMatches(document, pageUrl)
  };
}

function parseMatch(matchNode: HTMLElement) {
  const matchID = matchNode.id.replace(/^R_/, "");
  const leagueName =
    textContent(
      matchNode.previousElementSibling?.classList.contains("league")
        ? matchNode.previousElementSibling.querySelector("label")
        : matchNode.closest(".tableDiv")?.querySelector(".league label")
    ) || "";
  const homeTeam =
    textContent(matchNode.querySelector(`#ht_${matchID}`)) ||
    textContent(matchNode.querySelector(".tableDiv-match-info__event div:first-child")) ||
    "";
  const awayTeam =
    textContent(matchNode.querySelector(`#at_${matchID}`)) ||
    textContent(matchNode.querySelector(".tableDiv-match-info__event div:nth-child(2)")) ||
    "";
  const drawLabel = textContent(matchNode.querySelector(".drawcss")) || "Hòa";

  if (!homeTeam || !awayTeam) {
    return [];
  }

  const fixtureId =
    matchNode.getAttribute("groupid") ||
    stableFixtureId(`${leagueName}|${homeTeam}|${awayTeam}|${matchID}`);

  const fullTimeRow = matchNode.querySelector(":scope > .col.row:not(.halfmatchStats)");
  const halfTimeRow = matchNode.querySelector(":scope > .col.row.halfmatchStats");

  return [
    ...parseMarketRow(fullTimeRow as HTMLElement | null, {
      fixtureId,
      leagueName,
      homeTeam,
      awayTeam,
      drawLabel,
      prefix: "FT",
      matchState: detectCmdMatchState(matchNode)
    }),
    ...parseMarketRow(halfTimeRow as HTMLElement | null, {
      fixtureId,
      leagueName,
      homeTeam,
      awayTeam,
      drawLabel,
      prefix: "1H",
      matchState: detectCmdMatchState(matchNode)
    })
  ];
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
    ...parseHdpMarket(
      rowNode.querySelector(".w-hdp .tableDiv-match-odds") as HTMLElement | null,
      {
        fixtureId: options.fixtureId,
        marketName: `${options.prefix} Handicap`,
        leagueName: options.leagueName,
        homeTeam: options.homeTeam,
        awayTeam: options.awayTeam,
        drawLabel: options.drawLabel,
        line: "",
        matchState: options.matchState
      }
    ),
    ...parseOuMarket(
      rowNode.querySelector(".w-ou .tableDiv-match-odds") as HTMLElement | null,
      {
        fixtureId: options.fixtureId,
        marketName: `${options.prefix} Over/Under`,
        leagueName: options.leagueName,
        homeTeam: options.homeTeam,
        awayTeam: options.awayTeam,
        drawLabel: options.drawLabel,
        line: "",
        matchState: options.matchState
      }
    ),
    ...parseOneXTwoMarket(
      rowNode.querySelector(".col-45 .tableDiv-match-odds__X12detail") as HTMLElement | null,
      {
        fixtureId: options.fixtureId,
        marketName: `${options.prefix} 1X2`,
        leagueName: options.leagueName,
        homeTeam: options.homeTeam,
        awayTeam: options.awayTeam,
        drawLabel: options.drawLabel,
        line: "",
        matchState: options.matchState
      }
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
    marketId: normalizeToken(context.marketName),
    outcomeId: `${context.fixtureId}:${normalizeToken(context.marketName)}:${normalizeToken(
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

function formatOutcome(name: string, line: string) {
  return [name, line].filter(Boolean).join(" ").trim();
}

function parseOddsValue(value: string) {
  return Number.parseFloat(value.replace(/[^\d./-]+/g, ""));
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

function textContent(node: Element | null | undefined) {
  return node?.textContent?.replace(/\s+/g, " ").trim() ?? "";
}
