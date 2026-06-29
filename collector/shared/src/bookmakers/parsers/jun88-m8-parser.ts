import crypto from "node:crypto";
import { JSDOM } from "jsdom";
import type { OddsSelection, OddsSnapshot } from "../../contracts.js";

type MarketContext = {
  fixtureId: string;
  marketName: string;
  line: string;
  homeTeam: string;
  awayTeam: string;
  drawLabel: string;
};

export function parseJun88M8Snapshot(
  html: string,
  pageUrl: string,
  collectorId = "jun88-m8"
): OddsSnapshot {
  const dom = new JSDOM(html);
  const document = dom.window.document;
  const selections = Array.from(document.querySelectorAll("tr[oddsid]"))
    .flatMap((rowNode) => parseOddsRow(rowNode as HTMLElement));

  return {
    source: {
      collectorId,
      bookmakerId: "jun88",
      lobbyId: "m8"
    },
    collectedAt: new Date().toISOString(),
    selections:
      selections.length > 0 ? selections : parseFallbackSelections(document, pageUrl)
  };
}

function parseOddsRow(rowNode: HTMLElement) {
  const oddsID = rowNode.getAttribute("oddsid") || "";
  const leagueName =
    textContent(
      rowNode.previousElementSibling?.querySelector(".Span_titleleague") ||
        rowNode.closest("table")?.querySelector(".Span_titleleague")
    ) || "";
  const detailTeams = resolveTeamsFromMoreBet(rowNode);
  const homeTeam = detailTeams.homeTeam || resolveHomeTeam(rowNode);
  const awayTeam = detailTeams.awayTeam || resolveAwayTeam(rowNode);
  const drawLabel = textContent(rowNode.querySelector(".Draw")) || "Hòa";
  const timeOrStatus = textContent(rowNode.querySelector(".Heading5"));

  if (!homeTeam || !awayTeam) {
    return [];
  }

  const fixtureId =
    rowNode.getAttribute("favid") ||
    stableFixtureId(`${leagueName}|${homeTeam}|${awayTeam}|${oddsID}|${timeOrStatus}`);

  const marketCells = Array.from(
    rowNode.querySelectorAll(":scope > td.Border_right_t, :scope > td.Td_t_br, :scope > td.Td_r_br")
  ) as HTMLElement[];

  if (marketCells.length < 6) {
    return [];
  }

  return [
    ...parseHdpMarket(marketCells[0], {
      fixtureId,
      marketName: "FT Handicap",
      line: "",
      homeTeam,
      awayTeam,
      drawLabel
    }),
    ...parseOuMarket(marketCells[1], {
      fixtureId,
      marketName: "FT Over/Under",
      line: "",
      homeTeam,
      awayTeam,
      drawLabel
    }),
    ...parseOneXTwoMarket(marketCells[2], {
      fixtureId,
      marketName: "FT 1X2",
      line: "",
      homeTeam,
      awayTeam,
      drawLabel
    }),
    ...parseHdpMarket(marketCells[3], {
      fixtureId,
      marketName: "1H Handicap",
      line: "",
      homeTeam,
      awayTeam,
      drawLabel
    }),
    ...parseOuMarket(marketCells[4], {
      fixtureId,
      marketName: "1H Over/Under",
      line: "",
      homeTeam,
      awayTeam,
      drawLabel
    }),
    ...parseOneXTwoMarket(marketCells[5], {
      fixtureId,
      marketName: "1H 1X2",
      line: "",
      homeTeam,
      awayTeam,
      drawLabel
    })
  ];
}

function parseHdpMarket(node: HTMLElement | undefined, base: MarketContext) {
  if (!node) {
    return [];
  }

  const lineTexts = Array.from(node.querySelectorAll(".Heading6"))
    .map((item) => textContent(item))
    .filter(Boolean);
  const buttons = Array.from(node.querySelectorAll(".PosOdds, .NegOdds")) as HTMLElement[];
  const [homeButton, awayButton] = buttons;
  const [homeLineRaw, awayLineRaw] = lineTexts;

  return [
    createSelection(homeButton, {
      ...base,
      outcomeName: formatOutcome(base.homeTeam, normalizeHandicapLine(homeLineRaw, "home"))
    }),
    createSelection(awayButton, {
      ...base,
      outcomeName: formatOutcome(base.awayTeam, normalizeHandicapLine(awayLineRaw || homeLineRaw, "away"))
    })
  ].filter((item): item is OddsSelection => item !== null);
}

function parseOuMarket(node: HTMLElement | undefined, base: MarketContext) {
  if (!node) {
    return [];
  }

  const line = textContent(node.querySelector(".Heading6"));
  const buttons = Array.from(node.querySelectorAll(".PosOdds, .NegOdds")) as HTMLElement[];
  const [overButton, underButton] = buttons;

  return [
    createSelection(overButton, {
      ...base,
      outcomeName: formatOutcome("Over", line)
    }),
    createSelection(underButton, {
      ...base,
      outcomeName: formatOutcome("Under", line)
    })
  ].filter((item): item is OddsSelection => item !== null);
}

function parseOneXTwoMarket(node: HTMLElement | undefined, base: MarketContext) {
  if (!node) {
    return [];
  }

  const buttons = Array.from(node.querySelectorAll(".X12Odds span")) as HTMLElement[];
  const [homeButton, awayButton, drawButton] = buttons.filter((button) => textContent(button) !== "");

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
  if (!Number.isFinite(oddsValue)) {
    return null;
  }

  return {
    fixtureId: context.fixtureId,
    marketId: normalizeToken(context.marketName),
    outcomeId: `${context.fixtureId}:${normalizeToken(context.marketName)}:${normalizeToken(
      context.outcomeName
    )}`,
    outcomeName: context.outcomeName,
    odds: oddsValue,
    availableStake: 0,
    suspended: false
  };
}

function resolveAwayTeam(rowNode: HTMLElement) {
  const teamNodes = Array.from(rowNode.querySelectorAll(".Give, .Take"));
  if (teamNodes.length >= 2) {
    return textContent(teamNodes[1]);
  }

  const spans = Array.from(rowNode.querySelectorAll("span"))
    .map((node) => textContent(node))
    .filter(Boolean);

  return spans[1] || "";
}

function resolveHomeTeam(rowNode: HTMLElement) {
  const teamNodes = Array.from(rowNode.querySelectorAll(".Give, .Take"));
  if (teamNodes.length >= 1) {
    return textContent(teamNodes[0]);
  }

  const spans = Array.from(rowNode.querySelectorAll("span"))
    .map((node) => textContent(node))
    .filter(Boolean);

  return spans[0] || "";
}

function resolveTeamsFromMoreBet(rowNode: HTMLElement) {
  const link = rowNode.querySelector("[onclick*='MoreBetGen.aspx']")?.getAttribute("onclick") || "";
  const homeMatch = link.match(/[?&]home=([^&']+)/i);
  const awayMatch = link.match(/[?&]away=([^&']+)/i);

  return {
    homeTeam: sanitizeTeamLabel(homeMatch?.[1]),
    awayTeam: sanitizeTeamLabel(awayMatch?.[1])
  };
}

function sanitizeTeamLabel(value?: string) {
  if (!value) {
    return "";
  }

  return decodeURIComponent(value.replace(/\+/g, " "))
    .replace(/\s+\((ET|PEN|HDP|OU)\)$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseFallbackSelections(document: Document, pageUrl: string) {
  const leagueTitles = Array.from(document.querySelectorAll(".Span_titleleague"))
    .map((node) => textContent(node))
    .filter(Boolean);

  return leagueTitles.map((title, index) => ({
    fixtureId: stableFixtureId(`${pageUrl}|${index}|${title}`),
    marketId: "raw-league",
    outcomeId: stableFixtureId(`raw-league|${index}|${title}`),
    outcomeName: title,
    odds: 0,
    availableStake: 0,
    suspended: true
  }));
}

function normalizeHandicapLine(line: string, side: "home" | "away") {
  if (!line) {
    return "";
  }

  const trimmed = line.replace(/\s+/g, "");
  if (!trimmed) {
    return "";
  }

  if (side === "home") {
    return trimmed.startsWith("-") ? trimmed : `+${trimmed}`;
  }

  return trimmed.startsWith("-") ? trimmed.slice(1) : `-${trimmed}`;
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
