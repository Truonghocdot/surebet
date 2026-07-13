import type { CollectContext, CollectorRuntime, OddsSnapshot } from "../contracts.js";
import { collectorLaunchOptions } from "../core/browser.js";
import { writeDebugArtifacts } from "../core/debug.js";
import { installCollectorResourceBlocking } from "../core/resource-blocking.js";
import { parseEightXBetIncomingSnapshot } from "./parsers/eightxbet-incoming-parser.js";
import type { Browser, BrowserContext, Page } from "playwright";
import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";

const EIGHTXBET_INCOMING_PATH = "/sportEvents/incoming/football?hour=6";
const EIGHTXBET_PREFERENCES_PATH = "/mine";
const EIGHTXBET_READY_SELECTOR = '[data-testid^="v4-sport-asia-simple-handicap-unit-"]';
const EIGHTXBET_INFINITE_SCROLL_BOTTOM = '[data-testid="v4-sport-simple-handicap-infinite-scroll-bottom"]';
const EIGHTXBET_CARD_SELECTOR = '[data-testid^="simple-handicap-layout-football-"]';
const EIGHTXBET_ODDS_BUTTON_SELECTOR = 'button[data-testid^="oddsBtn-"]';
const EIGHTXBET_TEAM_SELECTOR = `${EIGHTXBET_CARD_SELECTOR} small.text-text-2`;
const EIGHTXBET_HUMAN_SCROLL_PATTERN = [110, 140, 155, 175];
const EIGHTXBET_HUMAN_SCROLL_PAUSES_MS = [180, 260, 220, 320];

chromium.use(stealth());

let sharedBrowser: Browser | null = null;
let sharedBrowserPromise: Promise<Browser> | null = null;

export class EightXBetRuntime implements CollectorRuntime {
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private targetURL = "";

  constructor(private readonly collectorId: string) {}

  async collect(context: CollectContext) {
    const targetURL = resolveEightXBetTargetURL(context.pageURL);
    const page = await this.ensurePage(targetURL);

    try {
      await waitForEightXBetReady(page, targetURL);
      await autoScrollIncomingList(page);
      const renderState = await stabilizeIncomingList(page);
      if (renderState.oddsButtonCount === 0 || renderState.teamLabelCount < 2) {
        await writeDebugArtifacts(page, `${this.collectorId}-incoming-not-hydrated`);
        throw new Error(
          "8xbet incoming list rendered shell rows, but odds buttons did not hydrate in time."
        );
      }

      const html = await page.content();
      const snapshot = parseEightXBetIncomingSnapshot(html, page.url(), this.collectorId);
      if (isRawFallbackSnapshot(snapshot)) {
        await writeDebugArtifacts(page, `${this.collectorId}-raw-fallback`);
        throw new Error(
          "8xbet parser returned only raw-card fallback; live odds buttons were not extracted."
        );
      }
      return snapshot;
    } catch (error) {
      await writeDebugArtifacts(page, `${this.collectorId}-collect-failed`);
      await this.resetPage();
      throw error;
    }
  }

  private async ensurePage(targetURL: string) {
    if (
      this.page &&
      !this.page.isClosed() &&
      this.context &&
      this.targetURL === targetURL &&
      sharedBrowser?.isConnected()
    ) {
      return this.page;
    }

    await this.resetPage();

    const browser = await getSharedBrowser();
    const context = await browser.newContext({
      locale: "vi-VN",
      timezoneId: "Asia/Ho_Chi_Minh",
      extraHTTPHeaders: {
        "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7"
      }
    });
    await installCollectorResourceBlocking(context);
    await installEightXBetLocale(context);

    const page = await context.newPage();
    this.context = context;
    this.page = page;
    this.targetURL = targetURL;

    await bootstrapEightXBetPreferences(page, targetURL);
    await page.goto(targetURL, { waitUntil: "domcontentloaded" });
    return page;
  }

  private async resetPage() {
    const context = this.context;
    this.context = null;
    this.page = null;
    this.targetURL = "";
    await context?.close().catch(() => undefined);
  }
}

async function getSharedBrowser() {
  if (sharedBrowser?.isConnected()) {
    return sharedBrowser;
  }

  if (!sharedBrowserPromise) {
    sharedBrowserPromise = chromium
      .launch(await collectorLaunchOptions(true))
      .then((browser) => {
        sharedBrowser = browser;
        browser.on("disconnected", () => {
          if (sharedBrowser === browser) {
            sharedBrowser = null;
          }
        });
        return browser;
      })
      .finally(() => {
        sharedBrowserPromise = null;
      });
  }

  return sharedBrowserPromise;
}

async function installEightXBetLocale(context: BrowserContext) {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "language", {
      configurable: true,
      get: () => "vi-VN"
    });
    Object.defineProperty(navigator, "languages", {
      configurable: true,
      get: () => ["vi-VN", "vi", "en-US", "en"]
    });
    try {
      window.localStorage.setItem("i18nextLng", "vi-VN");
      window.localStorage.setItem("language", "vi-VN");
      window.localStorage.setItem("lang", "vi-VN");
      window.localStorage.setItem("sport-market-type", "ML");
      window.localStorage.setItem("sport-match-mode", "professional");
      window.localStorage.setItem("sport-simple-type", "asia");
      window.sessionStorage.setItem("i18nextLng", "vi-VN");
      window.sessionStorage.setItem("language", "vi-VN");
      window.sessionStorage.setItem("lang", "vi-VN");
      window.sessionStorage.setItem("sport-market-type", "ML");
      window.sessionStorage.setItem("sport-match-mode", "professional");
      window.sessionStorage.setItem("sport-simple-type", "asia");
    } catch {}
  });
}

async function bootstrapEightXBetPreferences(page: Page, targetURL: string) {
  const preferenceURL = new URL(EIGHTXBET_PREFERENCES_PATH, targetURL).toString();

  try {
    await page.goto(preferenceURL, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => undefined);
    await page.evaluate(() => {
      const entries = [
        ["i18nextLng", "vi-VN"],
        ["language", "vi-VN"],
        ["lang", "vi-VN"],
        ["sport-market-type", "ML"],
        ["sport-match-mode", "professional"],
        ["sport-simple-type", "asia"]
      ] as const;

      for (const [key, value] of entries) {
        window.localStorage.setItem(key, value);
        window.sessionStorage.setItem(key, value);
      }
    });
    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
  } catch (error) {
    console.warn("[8xbet-worker] bootstrap /mine preferences failed:", error);
  }
}

async function waitForEightXBetReady(page: Page, targetURL: string) {
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  let ready = await page.waitForSelector(EIGHTXBET_READY_SELECTOR, { timeout: 20_000 }).then(
    () => true,
    () => false
  );

  if (!ready) {
    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
    await page.goto(targetURL, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
    ready = await page.waitForSelector(EIGHTXBET_READY_SELECTOR, { timeout: 20_000 }).then(
      () => true,
      () => false
    );
  }

  if (!ready) {
    throw new Error("8xbet incoming list did not render in time.");
  }
}

function isRawFallbackSnapshot(snapshot: OddsSnapshot) {
  return (
    snapshot.selections.length > 0 &&
    snapshot.selections.every((selection) => selection.marketId === "raw-card")
  );
}

function resolveEightXBetTargetURL(value: string) {
  const parsed = new URL(value);
  if (parsed.pathname.includes("/sportEvents/")) {
    return parsed.toString();
  }

  return new URL(EIGHTXBET_INCOMING_PATH, parsed).toString();
}

async function autoScrollIncomingList(page: Page) {
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  }).catch(() => undefined);
  await page.waitForTimeout(250);

  let previousState = await readIncomingListState(page);

  for (let cycle = 0; cycle < 5; cycle += 1) {
    await performHumanScrollCycle(page, cycle);

    const nextState = await waitForHydrationProgress(page, previousState);
    const countsAdvanced =
      nextState.cardCount > previousState.cardCount ||
      nextState.oddsButtonCount > previousState.oddsButtonCount ||
      nextState.teamLabelCount > previousState.teamLabelCount;

    previousState = nextState;
    if (countsAdvanced) {
      await page.waitForTimeout(450);
    } else if (nextState.bottomVisible || nextState.atEnd) {
      await page.waitForTimeout(650);
    } else {
      await page.waitForTimeout(300);
    }

    if ((nextState.bottomVisible || nextState.atEnd) && nextState.oddsButtonCount > 0) {
      return;
    }
  }
}

async function stabilizeIncomingList(page: Page) {
  let previousState = await readIncomingListState(page);
  let stableRounds = 0;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.waitForTimeout(550);

    const currentState = await readIncomingListState(page);
    const countsStable =
      currentState.cardCount === previousState.cardCount &&
      currentState.oddsButtonCount === previousState.oddsButtonCount &&
      currentState.teamLabelCount === previousState.teamLabelCount;

    if (countsStable && currentState.oddsButtonCount > 0) {
      stableRounds += 1;
    } else {
      stableRounds = 0;
    }

    if (stableRounds >= 2) {
      return currentState;
    }

    if (!currentState.atEnd && !currentState.bottomVisible) {
      await performHumanScrollCycle(page, attempt + 20, 1);
    }

    previousState = currentState;
  }

  return previousState;
}

type EightXBetIncomingListState = {
  cardCount: number;
  oddsButtonCount: number;
  teamLabelCount: number;
  bottomVisible: boolean;
  atEnd: boolean;
};

async function readIncomingListState(page: Page): Promise<EightXBetIncomingListState> {
  return page.evaluate(
    ({ bottomSelector, cardSelector, oddsSelector, teamSelector }) => {
      const bottomNode = document.querySelector(bottomSelector);
      const bottomRect = bottomNode?.getBoundingClientRect();
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
      const scrollElement = document.scrollingElement || document.documentElement;
      const scrollTop = scrollElement?.scrollTop ?? window.scrollY ?? 0;
      const scrollHeight = scrollElement?.scrollHeight ?? 0;

      return {
        cardCount: document.querySelectorAll(cardSelector).length,
        oddsButtonCount: document.querySelectorAll(oddsSelector).length,
        teamLabelCount: document.querySelectorAll(teamSelector).length,
        bottomVisible: !!bottomRect && bottomRect.top <= viewportHeight + 24,
        atEnd: scrollTop + viewportHeight >= scrollHeight - 24
      };
    },
    {
      bottomSelector: EIGHTXBET_INFINITE_SCROLL_BOTTOM,
      cardSelector: EIGHTXBET_CARD_SELECTOR,
      oddsSelector: EIGHTXBET_ODDS_BUTTON_SELECTOR,
      teamSelector: EIGHTXBET_TEAM_SELECTOR
    }
  );
}

async function performHumanScrollCycle(
  page: Page,
  cycle: number,
  steps = EIGHTXBET_HUMAN_SCROLL_PATTERN.length
) {
  for (let stepIndex = 0; stepIndex < steps; stepIndex += 1) {
    const patternIndex = (cycle + stepIndex) % EIGHTXBET_HUMAN_SCROLL_PATTERN.length;
    const scrollDelta = EIGHTXBET_HUMAN_SCROLL_PATTERN[patternIndex];
    const pauseMs = EIGHTXBET_HUMAN_SCROLL_PAUSES_MS[patternIndex];

    const wheeled = await page.mouse.wheel(0, scrollDelta).then(
      () => true,
      () => false
    );
    if (!wheeled) {
      await page.evaluate((delta) => {
        window.scrollBy(0, delta);
      }, scrollDelta).catch(() => undefined);
    }
    await page.waitForTimeout(pauseMs);
  }
}

async function waitForHydrationProgress(
  page: Page,
  baseline: EightXBetIncomingListState
) {
  let best = baseline;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await page.waitForTimeout(240 + attempt * 120);
    const current = await readIncomingListState(page);
    if (
      current.cardCount > best.cardCount ||
      current.oddsButtonCount > best.oddsButtonCount ||
      current.teamLabelCount > best.teamLabelCount
    ) {
      best = current;
    } else if (current.bottomVisible || current.atEnd) {
      best = current;
    }

    if (best.oddsButtonCount > baseline.oddsButtonCount && best.teamLabelCount >= 2) {
      return best;
    }

    if ((best.bottomVisible || best.atEnd) && best.oddsButtonCount > 0) {
      return best;
    }
  }

  return best;
}
