import crypto from "node:crypto";
import { JSDOM } from "jsdom";
import type { OddsSelection, OddsSnapshot } from "../../contracts.js";

export function parseEightXBetExhaustiveSnapshot(
  html: string,
  pageUrl: string,
  collectorId = "8xbet",
  targetFixtureId = ""
): OddsSnapshot {
  const dom = new JSDOM(html);
  const document = dom.window.document;

  const section = document.querySelector('[data-testid="ExhaustiveContentV4"]');
  if (!section) {
    return emptySnapshot(collectorId);
  }

  const fixtureId = targetFixtureId || inferFixtureIdFromExhaustiveContent(section as HTMLElement);
  if (!fixtureId) {
    return emptySnapshot(collectorId);
  }

  const cardNode =
    document.querySelector(`[data-testid="simple-handicap-layout-football-${fixtureId}"]`) ??
    document.querySelector(`[data-testid^="simple-handicap-layout-football-${fixtureId}"]`);
  if (!(cardNode instanceof dom.window.HTMLElement)) {
    return emptySnapshot(collectorId);
  }

  const leagueName =
    textContent(document.querySelector('[data-testid="exhaustive-navigator-v4"]')) ||
    textContent(
      cardNode
        .closest('[data-testid^="v4-sport-asia-simple-handicap-unit-"]')
        ?.querySelector('[data-testid="simple-handicap-odds-header"] span')
    ) ||
    "";
  const teamNames = extractTeamNames(cardNode);
  if (teamNames.length < 2) {
    return emptySnapshot(collectorId);
  }

  const [homeTeam, awayTeam] = teamNames;
  const matchState = "live" as const;
  const selections = [
    ...parseExhaustiveMarket(section as HTMLElement, fixtureId, "ah", {
      marketName: "Cược Chấp",
      leagueName,
      homeTeam,
      awayTeam,
      matchState
    }),
    ...parseExhaustiveMarket(section as HTMLElement, fixtureId, "ah_1st", {
      marketName: "Cược Chấp - Hiệp 1",
      leagueName,
      homeTeam,
      awayTeam,
      matchState
    }),
    ...parseExhaustiveMarket(section as HTMLElement, fixtureId, "ou", {
      marketName: "Tổng Số Bàn Thắng: Tài / Xỉu",
      leagueName,
      homeTeam,
      awayTeam,
      matchState
    }),
    ...parseExhaustiveMarket(section as HTMLElement, fixtureId, "ou_1st", {
      marketName: "Tổng Số Bàn Thắng: Tài / Xỉu - Hiệp 1",
      leagueName,
      homeTeam,
      awayTeam,
      matchState
    })
  ];

  return {
    source: {
      collectorId,
      bookmakerId: "8xbet",
      lobbyId: "default"
    },
    collectedAt: new Date().toISOString(),
    selections
  };
}

function parseExhaustiveMarket(
  section: HTMLElement,
  fixtureId: string,
  marketCode: "ah" | "ah_1st" | "ou" | "ou_1st",
  context: {
    marketName: string;
    leagueName: string;
    homeTeam: string;
    awayTeam: string;
    matchState: "live";
  }
) {
  const wrapper = section.querySelector(
    `[data-testid="ExhaustiveMarketCardWrapper-${marketCode}"]`
  ) as HTMLElement | null;
  if (!wrapper) {
    return [];
  }

  const buttons = Array.from(
    wrapper.querySelectorAll(`button[data-testid^="oddsBtn-1|${fixtureId}|${marketCode}|"]`)
  ) as HTMLElement[];

  const expectedSelections = 2;
  if (buttons.length < expectedSelections) {
    return [];
  }

  const groupedSelections = new Map<string, Map<string, OddsSelection>>();

  for (const buttonNode of buttons) {
    const parsed = parseExhaustiveOddsButton(buttonNode, fixtureId, marketCode, context);
    if (!parsed) {
      continue;
    }

    const group = groupedSelections.get(parsed.lineKey) ?? new Map<string, OddsSelection>();
    group.set(parsed.sideKey, parsed.selection);
    groupedSelections.set(parsed.lineKey, group);
  }

  const selections: OddsSelection[] = [];
  for (const group of groupedSelections.values()) {
    if (group.size !== expectedSelections) {
      continue;
    }

    if (marketCode.startsWith("ah")) {
      const home = group.get("home");
      const away = group.get("away");
      if (home && away) {
        selections.push(home, away);
      }
      continue;
    }

    const over = group.get("over");
    const under = group.get("under");
    if (over && under) {
      selections.push(over, under);
    }
  }

  return selections;
}

function parseExhaustiveOddsButton(
  buttonNode: HTMLElement,
  fixtureId: string,
  marketCode: "ah" | "ah_1st" | "ou" | "ou_1st",
  context: {
    marketName: string;
    leagueName: string;
    homeTeam: string;
    awayTeam: string;
    matchState: "live";
  }
): { selection: OddsSelection; lineKey: string; sideKey: string } | null {
  const testID = buttonNode.getAttribute("data-testid") || "";
  const parts = testID.replace(/^oddsBtn-/, "").split("|");
  if (parts.length < 4) {
    return null;
  }

  const sideCode = parts[3] || "";
  const lineOrOutcome = extractPrimaryText(buttonNode);
  const lineKey = resolveEightXBetLineKey(marketCode, lineOrOutcome);
  const sideKey = resolveEightXBetSideKey(marketCode, sideCode);
  if (!sideKey) {
    return null;
  }

  const oddsValue = extractOddsText(buttonNode);
  const odds = Number.parseFloat(oddsValue);
  if (!Number.isFinite(odds)) {
    return null;
  }

  const outcomeName = resolveOutcomeName(
    context.marketName,
    marketCode,
    sideCode,
    context.homeTeam,
    context.awayTeam,
    lineOrOutcome
  );
  const marketId = resolveMarketID(context.marketName, marketCode);

  return {
    lineKey,
    sideKey,
    selection: {
      fixtureId,
      homeTeam: context.homeTeam,
      awayTeam: context.awayTeam,
      leagueName: context.leagueName,
      matchState: context.matchState,
      marketId,
      outcomeId: `${fixtureId}:${marketId}:${normalizeToken(outcomeName)}`,
      outcomeName,
      odds,
      availableStake: 0,
      suspended: buttonNode.className.includes("cursor-default")
    }
  };
}

function inferFixtureIdFromExhaustiveContent(section: HTMLElement) {
  const button = section.querySelector('button[data-testid^="oddsBtn-1|"]');
  if (!(button instanceof section.ownerDocument.defaultView!.HTMLElement)) {
    return "";
  }

  const parts = (button.getAttribute("data-testid") || "").replace(/^oddsBtn-/, "").split("|");
  return parts[1] || "";
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

  return [marketName, sideCode, line].filter(Boolean).join(" ").trim();
}

function extractPrimaryText(buttonNode: HTMLElement) {
  const pieces = Array.from(buttonNode.querySelectorAll("small, div, span"))
    .map((node) => textContent(node))
    .filter(Boolean);

  return pieces.find((value) => value !== extractOddsText(buttonNode)) || "";
}

function extractOddsText(buttonNode: HTMLElement) {
  const values = Array.from(buttonNode.querySelectorAll("small, div, span"))
    .map((node) => textContent(node))
    .filter(Boolean);

  return values.reverse().find((value) => /^-?\d+(\.\d+)?$/.test(value)) || "";
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
  const canonicalMarketID = resolveCanonicalEightXBetMarketID(marketCode);
  if (canonicalMarketID) {
    return canonicalMarketID;
  }

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

function resolveCanonicalEightXBetMarketID(marketCode: string) {
  switch (marketCode) {
    case "ah":
      return "hdp-ah";
    case "ah_1st":
      return "hdp-ah-1st";
    case "ou":
      return "o-u-ou";
    case "ou_1st":
      return "o-u-ou-1st";
    default:
      return "";
  }
}

function resolveEightXBetLineKey(marketCode: string, value: string) {
  if (marketCode.startsWith("ah")) {
    return normalizeAbsoluteLineKey(value);
  }
  if (marketCode.startsWith("ou")) {
    return sanitizeOuLine(value);
  }
  return normalizeRawText(value);
}

function normalizeAbsoluteLineKey(value: string) {
  return value.replace(/\s+/g, "").replace(/^[+-]/, "").trim();
}

function resolveEightXBetSideKey(marketCode: string, sideCode: string) {
  if (marketCode.startsWith("ah")) {
    if (sideCode === "h") {
      return "home";
    }
    if (sideCode === "a") {
      return "away";
    }
    return "";
  }

  if (sideCode === "ov") {
    return "over";
  }
  if (sideCode === "ud") {
    return "under";
  }
  return "";
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
    normalized === "ft" ||
    normalized === "vs"
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

function emptySnapshot(collectorId: string): OddsSnapshot {
  return {
    source: {
      collectorId,
      bookmakerId: "8xbet",
      lobbyId: "default"
    },
    collectedAt: new Date().toISOString(),
    selections: []
  };
}

function stableFixtureId(input: string) {
  return crypto.createHash("sha1").update(input).digest("hex");
}
