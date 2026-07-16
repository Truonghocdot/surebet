import crypto from "node:crypto";
import { JSDOM } from "jsdom";
import type { OddsSelection, OddsSnapshot } from "../../contracts.js";

export type EightXBetParseDiagnostics = {
  partialMarketsDropped: number;
  partialMarketKeys: string[];
};

export function parseEightXBetIncomingSnapshot(
  html: string,
  pageUrl: string,
  collectorId = "8xbet",
  diagnostics?: EightXBetParseDiagnostics
): OddsSnapshot {
  const dom = new JSDOM(html);
  const document = dom.window.document;
  const cards = Array.from(document.querySelectorAll('[data-testid^="simple-handicap-layout-football-"]'));
  const forceLive = isEightXBetInplayPage(pageUrl);
  const selections = cards.flatMap((card) =>
    parseMatchCard(card as HTMLElement, { forceLive }, diagnostics)
  );

  return {
    source: {
      collectorId,
      bookmakerId: "8xbet",
      lobbyId: "default"
    },
    collectedAt: new Date().toISOString(),
    selections:
      selections.length > 0 ? selections : parseFallbackSelections(document, pageUrl)
  };
}

function parseMatchCard(
  cardNode: HTMLElement,
  options: { forceLive: boolean },
  diagnostics?: EightXBetParseDiagnostics
) {
  const leagueName =
    textContent(
      cardNode
        .closest('[data-testid^="v4-sport-asia-simple-handicap-unit-"]')
        ?.querySelector('[data-testid="simple-handicap-odds-header"] span')
    ) || "";
  const fixtureId =
    extractFixtureId(cardNode.getAttribute("data-testid") || "") ||
    stableFixtureId(`${leagueName}|${textContent(cardNode)}`);
  const gameStage = textContent(cardNode.querySelector('[data-testid="simple-game-stage"]'));
  const teamNames = extractTeamNames(cardNode);

  if (teamNames.length < 2) {
    return [];
  }

  const [homeTeam, awayTeam] = teamNames;
  const matchState = options.forceLive ? "live" : classifyEightXBetGameStage(gameStage);
  const eventStartAt = options.forceLive ? undefined : extractEightXBetEventStartAt(gameStage);
  const columns = Array.from(
    cardNode.querySelectorAll('[data-testid="sport-simple-asia-odds-layout"]')
  ) as HTMLElement[];
  const headers = Array.from(cardNode.querySelectorAll('[data-testid="sport-hover-popover"]'))
    .map((node) => extractMarketHeader(node as HTMLElement))
    .filter(Boolean);

  const selections: OddsSelection[] = [];
  for (let index = 0; index < columns.length; index += 1) {
    const column = columns[index];
    const marketName = headers[index] || `market-${index + 1}`;
    selections.push(
      ...parseMarketColumn(column, {
        fixtureId,
        marketName,
        leagueName,
        homeTeam,
        awayTeam,
        matchState,
        eventStartAt
      }, diagnostics)
    );
  }

  void gameStage;
  return selections;
}

function extractTeamNames(cardNode: HTMLElement) {
  const leftColumn =
    (cardNode.querySelector(".flex.w-full.flex-row.justify-between.pb-0.pt-2 > div") as
      | HTMLElement
      | null) ?? cardNode;

  return Array.from(leftColumn.querySelectorAll("small.text-text-2"))
    .filter((node) => !node.closest('button[data-testid^="oddsBtn-"]'))
    .filter((node) => !node.closest('[data-testid="simple-game-stage"]'))
    .filter((node) => !node.closest('[data-testid="simple-handicap-game-header-count-icon"]'))
    .map((node) => textContent(node))
    .filter(Boolean)
    .filter(isLikelyParticipantName)
    .slice(0, 2);
}

function parseMarketColumn(
  columnNode: HTMLElement,
  context: {
    fixtureId: string;
    marketName: string;
    leagueName: string;
    homeTeam: string;
    awayTeam: string;
    matchState: "upcoming" | "live" | "finished" | "unknown";
    eventStartAt?: string;
  },
  diagnostics?: EightXBetParseDiagnostics
) {
  const buttons = Array.from(columnNode.querySelectorAll('button[data-testid^="oddsBtn-"]')) as HTMLElement[];
  if (buttons.length === 0) {
    return [];
  }

  const firstTestID = buttons[0]?.getAttribute("data-testid") || "";
  const firstParts = firstTestID.replace(/^oddsBtn-/, "").split("|");
  const marketCode = firstParts[2] || "";

  if (!isSupportedEightXBetMarketCode(marketCode)) {
    recordPartialMarket(
      diagnostics,
      `${context.fixtureId}|${normalizeToken(context.marketName)}|unsupported=${marketCode}`
    );
    return [];
  }

  const expectedSelections = expectedSelectionCount(marketCode);

  if (buttons.length < expectedSelections) {
    recordPartialMarket(
      diagnostics,
      `${context.fixtureId}|${normalizeToken(context.marketName)}|expected=${expectedSelections}|actual=${buttons.length}`
    );
    return [];
  }

  const selections: Array<OddsSelection | null> = buttons
    .slice(0, expectedSelections)
    .map((buttonNode) => parseOddsButton(buttonNode, context));

  const completeSelections = selections.filter(isOddsSelection);
  if (completeSelections.length !== expectedSelections) {
    recordPartialMarket(
      diagnostics,
      `${context.fixtureId}|${normalizeToken(context.marketName)}|expected=${expectedSelections}|parsed=${completeSelections.length}`
    );
    return [];
  }
  return completeSelections;
}

function parseOddsButton(
  buttonNode: HTMLElement,
  context: {
    fixtureId: string;
    marketName: string;
    leagueName: string;
    homeTeam: string;
    awayTeam: string;
    matchState: "upcoming" | "live" | "finished" | "unknown";
    eventStartAt?: string;
  }
): OddsSelection | null {
  const testID = buttonNode.getAttribute("data-testid") || "";
  const parts = testID.replace(/^oddsBtn-/, "").split("|");
  if (parts.length < 4) {
    return null;
  }

  const marketCode = parts[2] || "";
  const sideCode = parts[3] || "";
  const line = extractLine(buttonNode);
  const oddsText = extractOddsText(buttonNode);
  const odds = Number.parseFloat(oddsText);
  if (!Number.isFinite(odds)) {
    return null;
  }

  const outcomeName = resolveOutcomeName(
    context.marketName,
    marketCode,
    sideCode,
    context.homeTeam,
    context.awayTeam,
    line
  );
  const marketId = resolveMarketID(context.marketName, marketCode);

  return {
    fixtureId: context.fixtureId,
    homeTeam: context.homeTeam,
    awayTeam: context.awayTeam,
    leagueName: context.leagueName,
    matchState: context.matchState,
    eventStartAt: context.eventStartAt,
    marketId,
    outcomeId: `${context.fixtureId}:${marketId}:${normalizeToken(outcomeName)}`,
    outcomeName,
    odds,
    availableStake: 0,
    suspended: buttonNode.className.includes("cursor-default")
  } satisfies OddsSelection;
}

function isOddsSelection(value: OddsSelection | null): value is OddsSelection {
  return value !== null;
}

function extractMarketHeader(node: HTMLElement) {
  const visibleLabel =
    textContent(node.querySelector(".line-clamp-1")) ||
    textContent(node.querySelector(".line-clamp-2"));
  if (visibleLabel) {
    return visibleLabel;
  }

  return dedupeRepeatedLabel(textContent(node));
}

function resolveOutcomeName(
  marketName: string,
  marketCode: string,
  sideCode: string,
  homeTeam: string,
  awayTeam: string,
  line: string
) {
  if (marketCode.startsWith("ah")) {
    if (sideCode === "h") {
      return formatOutcome(homeTeam, normalizeHandicapLine(line, "home"));
    }
    if (sideCode === "a") {
      return formatOutcome(awayTeam, normalizeHandicapLine(line, "away"));
    }
  }

  if (marketCode.startsWith("ou")) {
    if (sideCode === "ov") {
      return formatOutcome("Over", sanitizeOuLine(line));
    }
    if (sideCode === "ud") {
      return formatOutcome("Under", sanitizeOuLine(line));
    }
  }

  if (marketCode === "h-ou" || marketCode === "a-ou") {
    if (sideCode === "ov") {
      return formatOutcome("Over", sanitizeOuLine(line));
    }
    if (sideCode === "ud") {
      return formatOutcome("Under", sanitizeOuLine(line));
    }
  }

  if (marketCode === "btts") {
    if (sideCode === "y") {
      return "Yes";
    }
    if (sideCode === "n") {
      return "No";
    }
  }

  if (marketCode.startsWith("1x2")) {
    if (sideCode === "h") {
      return homeTeam;
    }
    if (sideCode === "a") {
      return awayTeam;
    }
    if (sideCode === "d") {
      return "Draw";
    }
  }

  return [marketName, sideCode, line].filter(Boolean).join(" ").trim();
}

function extractLine(buttonNode: HTMLElement) {
  const pieces = Array.from(buttonNode.querySelectorAll("small, div, span"))
    .map((node) => textContent(node))
    .filter(Boolean);

  return (
    pieces.find((value) => /[0-9]/.test(value) && value !== extractOddsText(buttonNode)) || ""
  );
}

function extractOddsText(buttonNode: HTMLElement) {
  const values = Array.from(buttonNode.querySelectorAll("small, div, span"))
    .map((node) => textContent(node))
    .filter(Boolean);

  return values.reverse().find((value) => /^-?\d+(\.\d+)?$/.test(value)) || "";
}

function parseFallbackSelections(document: Document, pageUrl: string) {
  return Array.from(document.querySelectorAll('[data-testid^="v4-sport-asia-simple-handicap-unit-"]'))
    .map((node, index) => textContent(node))
    .filter(Boolean)
    .map((textValue, index) => ({
      fixtureId: stableFixtureId(`${pageUrl}|${index}|${textValue}`),
      marketId: "raw-card",
      outcomeId: stableFixtureId(`raw-card|${index}|${textValue}`),
      outcomeName: textValue.slice(0, 120),
      odds: 0,
      availableStake: 0,
      suspended: true
    }));
}

function isEightXBetInplayPage(pageUrl: string) {
  try {
    return new URL(pageUrl).pathname.includes("/sportEvents/inplay/");
  } catch {
    return pageUrl.includes("/sportEvents/inplay/");
  }
}

function extractFixtureId(value: string) {
  const match = value.match(/football-(\d+)/i);
  return match?.[1] || "";
}

function classifyEightXBetGameStage(value: string) {
  const normalized = normalizeEightXBetStage(value);
  if (!normalized) {
    return "unknown" as const;
  }
  if (/(^|\\s)(1h|2h|ht|live|et|pen)(\\s|$)|\\d{1,2}'/i.test(normalized)) {
    return "live" as const;
  }
  if (/(^|\\s)(ft|ended|finished|final)(\\s|$)/i.test(normalized)) {
    return "finished" as const;
  }
  if (
    /\d{1,2}:\d{2}|am|pm|today|tomorrow/i.test(normalized) ||
    /^\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{2}$/i.test(normalized)
  ) {
    return "upcoming" as const;
  }
  if (/^\d{1,2}[-/]\d{1,2}\d{1,2}:\d{2}$/i.test(normalizeRawText(value))) {
    return "upcoming" as const;
  }
  return "unknown" as const;
}

function extractEightXBetEventStartAt(value: string) {
  const normalized = normalizeEightXBetStage(value);
  if (
    /\d{1,2}:\d{2}|am|pm/i.test(normalized) ||
    /^\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{2}$/i.test(normalized)
  ) {
    return normalized;
  }
  return undefined;
}

function normalizeEightXBetStage(value: string) {
  return normalizeRawText(value)
    .replace(/(\d{1,2}[-/]\d{1,2})(\d{1,2}:\d{2})/g, "$1 $2")
    .trim();
}

function normalizeHandicapLine(line: string, side: "home" | "away") {
  if (!line) {
    return "";
  }

  const trimmed = line.replace(/\s+/g, "");
  if (!trimmed) {
    return "";
  }
  if (trimmed.startsWith("+") || trimmed.startsWith("-")) {
    return trimmed;
  }

  if (side === "home") {
    return `+${trimmed}`;
  }

  return `-${trimmed}`;
}

function formatOutcome(base: string, line: string) {
  return [base, line].filter(Boolean).join(" ").trim();
}

function sanitizeOuLine(line: string) {
  return line
    .replace(/^(O|U|Tai|Xiu|Tài|Xỉu)\s+/i, "")
    .replace(/^(O|U|Tai|Xiu|Tài|Xỉu)$/i, "")
    .trim();
}

function resolveMarketID(marketName: string, marketCode: string) {
  const normalizedName = normalizeToken(dedupeRepeatedLabel(normalizeRawText(marketName)));
  const normalizedCode = normalizeToken(marketCode);

  if (normalizedName && normalizedCode) {
    return `${normalizedName}-${normalizedCode}`;
  }
  if (normalizedName) {
    return normalizedName;
  }
  return normalizedCode;
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

function normalizeRawText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function isLikelyParticipantName(value: string) {
  const normalized = normalizeRawText(value).toLowerCase();
  if (!normalized) {
    return false;
  }

  if (
    normalized === "upcoming" ||
    normalized === "live" ||
    normalized === "today" ||
    normalized === "tomorrow" ||
    normalized === "ht" ||
    normalized === "ft"
  ) {
    return false;
  }

  if (/^\d{1,2}:\d{2}$/.test(normalized) || /^\d{1,2}-\d{1,2}$/.test(normalized)) {
    return false;
  }

  return true;
}

function dedupeRepeatedLabel(value: string) {
  const normalized = normalizeRawText(value);
  if (!normalized) {
    return "";
  }

  const tokens = normalized.split(" ");
  if (tokens.length > 1 && tokens.length % 2 === 0) {
    const midpoint = tokens.length / 2;
    const left = tokens.slice(0, midpoint).join(" ");
    const right = tokens.slice(midpoint).join(" ");
    if (left === right) {
      return left;
    }
  }

  return normalized;
}

function expectedSelectionCount(marketCode: string) {
  if (marketCode.startsWith("1x2")) {
    return 3;
  }

  return 2;
}

function isSupportedEightXBetMarketCode(marketCode: string) {
  switch (marketCode) {
    case "ah":
    case "ah_1st":
    case "ou":
    case "ou_1st":
      return true;
    default:
      return false;
  }
}

function recordPartialMarket(
  diagnostics: EightXBetParseDiagnostics | undefined,
  key: string
) {
  if (!diagnostics) {
    return;
  }

  diagnostics.partialMarketsDropped += 1;
  if (!diagnostics.partialMarketKeys.includes(key)) {
    diagnostics.partialMarketKeys.push(key);
  }
}
