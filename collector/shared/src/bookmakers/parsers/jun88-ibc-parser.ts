import crypto from "node:crypto";
import { JSDOM } from "jsdom";
import type { OddsSelection, OddsSnapshot } from "../../contracts.js";

type MatchContext = {
  fixtureId: string;
  leagueName: string;
  homeTeam: string;
  awayTeam: string;
  drawLabel: string;
  marketTitles: string[];
  rows: HTMLElement[];
};

type ButtonContext = {
  fixtureId: string;
  marketName: string;
  leagueName: string;
  homeTeam: string;
  awayTeam: string;
  drawLabel: string;
  matchState: "upcoming" | "live" | "finished" | "unknown";
  eventStartAt?: string;
  buttons: HTMLElement[];
  button: HTMLElement;
  buttonIndex: number;
};

const DEFAULT_DRAW_LABEL = "Hòa";

export function parseJun88SabaSnapshot(
  html: string,
  pageUrl: string,
  collectorId = "jun88-saba"
): OddsSnapshot {
  const dom = new JSDOM(html);
  const document = dom.window.document;
  const selections = parseMatchSelections(document);

  return {
    source: {
      collectorId,
      bookmakerId: "jun88",
      lobbyId: "saba"
    },
    collectedAt: new Date().toISOString(),
    selections:
      selections.length > 0 ? selections : parseFeaturedCardSelections(document, pageUrl)
  };
}

export const parseJun88IbcSnapshot = parseJun88SabaSnapshot;

function parseMatchSelections(document: Document) {
  const matches = Array.from(document.querySelectorAll(".c-match"));

  return matches.flatMap((match) => parseMatch(match as HTMLElement));
}

function parseMatch(matchNode: HTMLElement): OddsSelection[] {
  const baseHomeTeam =
    textContent(matchNode.querySelector(".c-match__team .c-team:first-child .c-team-name")) || "";
  const baseAwayTeam =
    textContent(matchNode.querySelector(".c-match__team .c-team:nth-child(2) .c-team-name")) ||
    "";

  if (!baseHomeTeam || !baseAwayTeam) {
    return [];
  }

  const leagueName =
    textContent(matchNode.closest(".c-league")?.querySelector(".c-league__name")) || "";
  const fixtureId =
    matchNode.querySelector(".c-match__option")?.getAttribute("data-matchid") ||
    stableFixtureId(`${leagueName}|${baseHomeTeam}|${baseAwayTeam}`);
  const marketTitles = Array.from(matchNode.querySelectorAll(".c-bettype-title .c-bettype-col"))
    .map((node) => extractMarketTitle(node as HTMLElement))
    .filter(Boolean);
  const rows = Array.from(matchNode.querySelectorAll(".c-match__odds")) as HTMLElement[];

  if (rows.length === 0 || marketTitles.length === 0) {
    return [];
  }

  const context: MatchContext = {
    fixtureId,
    leagueName,
    homeTeam: baseHomeTeam,
    awayTeam: baseAwayTeam,
    drawLabel: DEFAULT_DRAW_LABEL,
    marketTitles,
    rows
  };

  return rows.flatMap((row) => parseMatchRow(context, row));
}

function parseMatchRow(context: MatchContext, row: HTMLElement) {
  const rowHomeTeam =
    textContent(row.querySelector(".c-match__event .c-match__team:first-child .c-team-name")) ||
    context.homeTeam;
  const rowAwayTeam =
    textContent(row.querySelector(".c-match__event .c-match__team:nth-child(2) .c-team-name")) ||
    context.awayTeam;
  const rowDrawLabel =
    textContent(row.querySelector(".c-match__event .c-match__team:nth-child(3) > .c-text")) ||
    context.drawLabel;
  const marketColumns = Array.from(row.querySelectorAll(":scope > .c-bettype-col")) as HTMLElement[];

  return marketColumns.flatMap((column, columnIndex) => {
    const marketName = context.marketTitles[columnIndex] || extractMarketTitle(column);
    const buttons = Array.from(column.querySelectorAll(":scope > .c-odds-button")) as HTMLElement[];

    if (!marketName || buttons.length === 0) {
      return [];
    }

    return buttons.map((button, buttonIndex) =>
      createSelection({
        fixtureId: context.fixtureId,
        marketName,
        leagueName: context.leagueName,
        homeTeam: rowHomeTeam,
        awayTeam: rowAwayTeam,
        drawLabel: rowDrawLabel,
        matchState: "unknown",
        buttons,
        button,
        buttonIndex
      })
    );
  });
}

function parseFeaturedCardSelections(document: Document, pageUrl: string) {
  const cards = Array.from(document.querySelectorAll(".c-event-card"));

  return cards.flatMap((card) => parseFeaturedCard(card as HTMLElement, pageUrl));
}

function parseFeaturedCard(cardNode: HTMLElement, pageUrl: string): OddsSelection[] {
  const leagueName =
    textContent(cardNode.querySelector(".c-event-card__header .c-text")) ||
    textContent(cardNode.querySelector(".c-text-league")) ||
    "";
  const homeTeam = textContent(cardNode.querySelector(".c-event-card__team-home .c-team-name")) || "";
  const awayTeam = textContent(cardNode.querySelector(".c-event-card__team-away .c-team-name")) || "";
  const matchTime = textContent(cardNode.querySelector(".c-event-card__info .c-match-time")) || "";

  if (!homeTeam || !awayTeam) {
    return [];
  }

  const fixtureId = stableFixtureId(`${pageUrl}|${leagueName}|${homeTeam}|${awayTeam}|${matchTime}`);

  return Array.from(cardNode.querySelectorAll(".c-event-card-bets"))
    .flatMap((betNode) => {
      const marketName =
        textContent(betNode.querySelector(".c-event-card-bets__header .c-text")) || "";
      const buttons = Array.from(
        betNode.querySelectorAll(".c-event-card-bets__main .c-odds-button")
      ) as HTMLElement[];

      if (!marketName || buttons.length === 0) {
        return [];
      }

      return buttons.map((button, buttonIndex) =>
        createSelection({
          fixtureId,
          marketName,
          leagueName,
          homeTeam,
          awayTeam,
          drawLabel: DEFAULT_DRAW_LABEL,
          matchState: "upcoming",
          eventStartAt: matchTime || undefined,
          buttons,
          button,
          buttonIndex
        })
      );
    });
}

function createSelection(context: ButtonContext): OddsSelection {
  const outcomeName = resolveOutcomeName(context);
  const oddsValue = parseOddsValue(textContent(context.button.querySelector(".c-odds")));

  return {
    fixtureId: context.fixtureId,
    homeTeam: context.homeTeam,
    awayTeam: context.awayTeam,
    leagueName: context.leagueName,
    matchState: context.matchState,
    eventStartAt: context.eventStartAt,
    marketId: normalizeToken(context.marketName),
    outcomeId: `${context.fixtureId}:${normalizeToken(context.marketName)}:${normalizeToken(outcomeName)}`,
    outcomeName,
    odds: Number.isFinite(oddsValue) ? oddsValue : 0,
    availableStake: 0,
    suspended: isSuspended(context.button, oddsValue)
  };
}

function resolveOutcomeName(context: ButtonContext) {
  const title = context.button.getAttribute("title");
  if (title) {
    return title.replace(/\s+/g, " ").trim();
  }

  const buttonID = context.button.id.toLowerCase();
  const sharedLine = resolveSharedLine(context.buttons);
  const label = textContent(context.button.querySelector(".c-text"));

  if (label === "H") {
    return formatOutcome(context.homeTeam, sharedLine);
  }

  if (label === "A") {
    return formatOutcome(context.awayTeam, sharedLine);
  }

  if (label === "o") {
    return formatOutcome("Over", sharedLine);
  }

  if (label === "u") {
    return formatOutcome("Under", sharedLine);
  }

  if (label === "e") {
    return "Even";
  }

  if (label && label !== "x") {
    return formatOutcome(label, sharedLine);
  }

  if (buttonID.endsWith("1")) {
    return context.homeTeam;
  }

  if (buttonID.endsWith("2")) {
    return context.awayTeam;
  }

  if (buttonID.endsWith("x")) {
    return context.drawLabel;
  }

  if (buttonID.endsWith("h")) {
    return formatOutcome(context.homeTeam, sharedLine);
  }

  if (buttonID.endsWith("a")) {
    return formatOutcome(context.awayTeam, sharedLine);
  }

  return `${context.marketName} ${context.buttonIndex + 1}`;
}

function resolveSharedLine(buttons: HTMLElement[]) {
  return buttons
    .map((button) => textContent(button.querySelector(".c-text-goal")))
    .find(Boolean);
}

function formatOutcome(base: string, line?: string) {
  return [base, line].filter(Boolean).join(" ").trim();
}

function extractMarketTitle(node: HTMLElement) {
  return (
    node.getAttribute("title") ||
    textContent(node.querySelector(".c-text")) ||
    textContent(node)
  );
}

function parseOddsValue(value: string) {
  const normalized = value.replace(/[^\d./-]+/g, "");
  return Number.parseFloat(normalized);
}

function isSuspended(button: HTMLElement, oddsValue: number) {
  if (!Number.isFinite(oddsValue)) {
    return true;
  }

  return (
    button.getAttribute("data-grey-out") === "true" ||
    Boolean(button.getAttribute("data-odds-status")) ||
    button.querySelector(".c-icon--lock, .c-close-price") !== null
  );
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
