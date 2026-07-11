import crypto from "node:crypto";
import { JSDOM } from "jsdom";
import type { OddsSelection, OddsSnapshot } from "../../contracts.js";

type RawSelection = {
  selectionName: string;
  points: string;
  odds: string;
};

type RawMarket = {
  marketName: string;
  selections: RawSelection[];
};

type RawEvent = {
  fixtureId: string;
  leagueName: string;
  startTime: string;
  homeTeam: string;
  awayTeam: string;
  markets: RawMarket[];
};

export function parseJun88BtiSnapshot(html: string, pageUrl: string): OddsSnapshot {
  const dom = new JSDOM(html);
  const document = dom.window.document;
  const eventCards = Array.from(
    document.querySelectorAll(".master_fe_Event_match.featured-matches-card-prelive-no-bg")
  );

  const rawEvents = eventCards
    .map((eventCard) => parseEventCard(eventCard as HTMLElement))
    .filter((item): item is RawEvent => item !== null);

  const selections = rawEvents.flatMap((event) => flattenEventSelections(event));

  return {
    source: {
      collectorId: "jun88-bti",
      bookmakerId: "jun88",
      lobbyId: "bti"
    },
    collectedAt: new Date().toISOString(),
    selections
  };
}

function parseEventCard(eventCard: HTMLElement): RawEvent | null {
  const link = eventCard.querySelector('a[href*="/asian-view/"]');
  const href = link?.getAttribute("href") ?? "";
  const fixtureId = extractFixtureId(href);

  const leagueName =
    textContent(eventCard.querySelector(".master_fe_PreLiveLine_leagueName")) || "";
  const startTime =
    textContent(eventCard.querySelector(".master_fe_PreLiveLine_date")) || "";
  const teamTitles = extractTeamTitles(eventCard);

  if (teamTitles.length < 2) {
    return null;
  }

  const markets = Array.from(
    eventCard.querySelectorAll(".master_fe_Markets_container")
  )
    .map((node) => parseSelectionGroup(node as HTMLElement))
    .filter((item): item is RawMarket => item !== null);

  if (markets.length === 0) {
    return null;
  }

  return {
    fixtureId:
      fixtureId ||
      stableFixtureId(`${leagueName}|${teamTitles[0]}|${teamTitles[1]}|${startTime}`),
    leagueName,
    startTime,
    homeTeam: teamTitles[0] ?? "",
    awayTeam: teamTitles[1] ?? "",
    markets
  };
}

function parseSelectionGroup(groupNode: HTMLElement): RawMarket | null {
  const marketName =
    textContent(groupNode.querySelector(".master_fe_Markets_eventMarket__marketName")) ||
    "";

  const visiblePage =
    (groupNode.querySelector('[data-swipeable="true"][aria-hidden="false"]') as HTMLElement | null) ??
    groupNode;

  const selections = Array.from(
    visiblePage.querySelectorAll(".master_fe_Selections_selection")
  )
    .map((node) => {
      const selectionName =
        textContent(node.querySelector(".master_fe_Selections_selectionNameLine > span:first-child")) ||
        textContent(node.querySelector(".master_fe_Selections_selectionNameLine")) ||
        "";
      const points = textContent(node.querySelector(".master_fe_Selections_points")) || "";
      const odds =
        textContent(node.querySelector(".master_fe_Selections_odds")) || "";

      if (!selectionName || !odds) {
        return null;
      }

      return {
        selectionName,
        points,
        odds
      };
    })
    .filter((item): item is RawSelection => item !== null);

  if (!marketName || selections.length === 0) {
    return null;
  }

  return {
    marketName,
    selections
  };
}

function flattenEventSelections(event: RawEvent): OddsSelection[] {
  const selections: OddsSelection[] = [];

  for (const market of event.markets) {
    const marketId = normalizeToken(market.marketName);

    for (const selection of market.selections) {
      const outcomeName = [selection.selectionName, selection.points]
        .filter(Boolean)
        .join(" ")
        .trim();
      const oddsValue = Number.parseFloat(selection.odds);

      selections.push({
        fixtureId: event.fixtureId,
        homeTeam: event.homeTeam,
        awayTeam: event.awayTeam,
        leagueName: event.leagueName,
        matchState: "upcoming",
        eventStartAt: event.startTime || undefined,
        marketId,
        outcomeId: `${event.fixtureId}:${marketId}:${normalizeToken(outcomeName)}`,
        outcomeName,
        odds: Number.isFinite(oddsValue) ? oddsValue : 0,
        availableStake: 0,
        suspended: !Number.isFinite(oddsValue)
      });
    }
  }

  return selections;
}

function extractFixtureId(href: string) {
  const parts = href.split("/").filter(Boolean);
  return parts.at(-1) ?? "";
}

function stableFixtureId(input: string) {
  return crypto.createHash("sha1").update(input).digest("hex");
}

function extractTeamTitles(eventCard: HTMLElement) {
  const eventNameTitles = Array.from(
    eventCard.querySelectorAll(".master_fe_EventName_eventName__title")
  )
    .map((node) => textContent(node))
    .filter(Boolean);

  if (eventNameTitles.length >= 2) {
    return eventNameTitles;
  }

  const participantTitles = Array.from(
    eventCard.querySelectorAll(".master_fe_Participant_participantName span[title]")
  )
    .map((node) => textContent(node))
    .filter(Boolean);

  if (participantTitles.length >= 2) {
    return participantTitles;
  }

  return [];
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
