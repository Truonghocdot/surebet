import type { CollectContext, CollectorRuntime, OddsSnapshot } from "../contracts.js";
import { collectorLaunchOptions } from "../core/browser.js";
import { writeDebugArtifacts } from "../core/debug.js";
import { envBool, envInt } from "../core/env.js";
import { installCollectorResourceBlocking } from "../core/resource-blocking.js";
import { parseEightXBetExhaustiveSnapshot } from "./parsers/eightxbet-exhaustive-parser.js";
import {
  browserRecycleIntervalMs,
  pageReloadIntervalMs,
  streamPollIntervalMs
} from "./streaming-utils.js";
import type {
  Browser,
  BrowserContext,
  Page,
  Response,
  WebSocket as PlaywrightWebSocket
} from "playwright";
import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";

const EIGHTXBET_INCOMING_PATH = "/sportEvents/incoming/football?hour=6";
const EIGHTXBET_PREFERENCES_PATH = "/mine";
const EIGHTXBET_READY_SELECTOR = '[data-testid^="simple-handicap-layout-football-"]';
const EIGHTXBET_CARD_SELECTOR = '[data-testid^="simple-handicap-layout-football-"]';
const EIGHTXBET_ODDS_BUTTON_SELECTOR = 'button[data-testid^="oddsBtn-"]';
const EIGHTXBET_TEAM_SELECTOR = `${EIGHTXBET_CARD_SELECTOR} small.text-text-2`;
const EIGHTXBET_EXHAUSTIVE_CONTENT_SELECTOR = '[data-testid="ExhaustiveContentV4"]';

chromium.use(stealth());

let sharedBrowser: Browser | null = null;
let sharedBrowserPromise: Promise<Browser> | null = null;

export class EightXBetRuntime implements CollectorRuntime {
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private targetURL = "";
  private lastPageReloadAt = 0;
  private sessionStartedAt = 0;
  private shutdownRequested = false;

  constructor(private readonly collectorId: string) {}

  async collect(context: CollectContext) {
    this.shutdownRequested = false;
    const targetURL = resolveEightXBetTargetURL(context.pageURL);
    const page = await this.ensurePage(targetURL);

    try {
      return this.readSnapshot(page, targetURL);
    } catch (error) {
      if (this.shutdownRequested) {
        return emptyEightXBetSnapshot(this.collectorId);
      }
      await writeDebugArtifacts(page, `${this.collectorId}-collect-failed`);
      await this.resetPage(true);
      throw error;
    }
  }

  async streamSnapshots(
    context: CollectContext,
    onSnapshot: (snapshot: OddsSnapshot, mode: "bootstrap" | "delta") => Promise<void>
  ) {
    this.shutdownRequested = false;
    const targetURL = resolveEightXBetTargetURL(context.pageURL);
    const page = await this.ensurePage(targetURL);
    let signalVersion = 0;
    let signalCount = 0;
    const bumpSignal = () => {
      signalVersion += 1;
      signalCount += 1;
    };
    const handleResponse = (response: Response) => {
      if (isEightXBetSignalResponse(response)) {
        bumpSignal();
        logEightXBetTelemetry(
          this.collectorId,
          "signal",
          `kind=network_response count=${signalCount} status=${response.status()} resource=${response.request().resourceType()} url=${truncateURL(response.url())}`
        );
      }
    };
    const handleWebSocket = (socket: PlaywrightWebSocket) => {
      if (!isEightXBetSignalSocket(socket.url())) {
        return;
      }
      socket.on("framereceived", () => {
        bumpSignal();
        logEightXBetTelemetry(
          this.collectorId,
          "signal",
          `kind=websocket_frame count=${signalCount} url=${truncateURL(socket.url())}`
        );
      });
    };
    page.on("response", handleResponse);
    page.on("websocket", handleWebSocket);

    try {
      let snapshot = await this.readSnapshot(page, targetURL);
      await onSnapshot(snapshot, "bootstrap");

      await installEightXBetObserver(page);
      let lastVersion = await readEightXBetObserverVersion(page);
      let lastSignalVersion = signalVersion;

      while (!page.isClosed()) {
        if (
          this.sessionStartedAt > 0 &&
          Date.now() - this.sessionStartedAt >= browserRecycleIntervalMs()
        ) {
          console.warn(`[${this.collectorId}] recycling browser session after TTL.`);
          return;
        }

        if (Date.now() - this.lastPageReloadAt >= pageReloadIntervalMs()) {
          await page.reload({ waitUntil: "domcontentloaded" });
          this.lastPageReloadAt = Date.now();

          snapshot = await this.readSnapshot(page, targetURL);
          await onSnapshot(snapshot, "bootstrap");
          await installEightXBetObserver(page);
          lastVersion = await readEightXBetObserverVersion(page);
          continue;
        }

        const currentVersion = await readEightXBetObserverVersion(page);
        const signalChanged = signalVersion !== lastSignalVersion;
        if (currentVersion !== lastVersion || signalChanged) {
          if (currentVersion !== lastVersion) {
            logEightXBetTelemetry(
              this.collectorId,
              "signal",
              `kind=dom_mutation version=${lastVersion}->${currentVersion}`
            );
          }
          snapshot = await this.readSnapshot(page, targetURL);
          await onSnapshot(snapshot, "delta");
          lastVersion = currentVersion;
          lastSignalVersion = signalVersion;
        }

        await page.waitForTimeout(Math.max(Math.floor(streamPollIntervalMs() / 2), 50));
      }
    } catch (error) {
      if (this.shutdownRequested) {
        return;
      }
      await writeDebugArtifacts(page, `${this.collectorId}-stream-failed`);
      await this.resetPage(true);
      throw error;
    } finally {
      page.off("response", handleResponse);
      page.off("websocket", handleWebSocket);
    }
  }

  async close() {
    this.shutdownRequested = true;
    await this.resetPage(true);
  }

  private async ensurePage(targetURL: string) {
    if (
      this.sessionStartedAt > 0 &&
      Date.now() - this.sessionStartedAt >= browserRecycleIntervalMs()
    ) {
      console.warn(`[${this.collectorId}] recycling browser session after TTL.`);
      await this.resetPage(true);
    }

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
    this.lastPageReloadAt = Date.now();
    this.sessionStartedAt = Date.now();
    return page;
  }

  private async reloadPageIfDue(page: Page) {
    if (Date.now() - this.lastPageReloadAt < pageReloadIntervalMs()) {
      return;
    }

    await page.reload({ waitUntil: "domcontentloaded" });
    this.lastPageReloadAt = Date.now();
  }

  private async resetPage(closeBrowser = false) {
    const context = this.context;
    this.context = null;
    this.page = null;
    this.targetURL = "";
    this.lastPageReloadAt = 0;
    this.sessionStartedAt = 0;
    await context?.close().catch(() => undefined);
    if (closeBrowser) {
      await closeSharedBrowser();
    }
  }

  private async readSnapshot(page: Page, targetURL: string): Promise<OddsSnapshot> {
    await this.reloadPageIfDue(page);
    await waitForEightXBetReady(page, targetURL);

    const fixtureIds = await readEightXBetFixtureIDs(page);
    const selections: OddsSnapshot["selections"] = [];

    for (const fixtureId of fixtureIds) {
      await openEightXBetExhaustiveContent(page, fixtureId);

      const html = await page.content();
      const snapshot = parseEightXBetExhaustiveSnapshot(
        html,
        page.url(),
        this.collectorId,
        fixtureId
      );
      if (snapshot.selections.length === 0) {
        logEightXBetTelemetry(
          this.collectorId,
          "exhaustive_empty",
          `fixture=${fixtureId}`
        );
        continue;
      }
      selections.push(...snapshot.selections);
    }

    if (selections.length === 0) {
      await writeDebugArtifacts(page, `${this.collectorId}-exhaustive-empty`);
      throw new Error("8xbet exhaustive content did not yield any supported selections.");
    }

    return {
      source: {
        collectorId: this.collectorId,
        bookmakerId: "8xbet",
        lobbyId: "default"
      },
      collectedAt: new Date().toISOString(),
      selections
    };
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

async function closeSharedBrowser() {
  const browser = sharedBrowser;
  sharedBrowser = null;
  await browser?.close().catch(() => undefined);
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
    await waitForPageSettle(page);
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
  await waitForPageSettle(page);
  let ready = await page.waitForSelector(EIGHTXBET_READY_SELECTOR, { timeout: 20_000 }).then(
    () => true,
    () => false
  );

  if (!ready) {
    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
    await page.goto(targetURL, { waitUntil: "domcontentloaded" });
    await waitForPageSettle(page);
    ready = await page.waitForSelector(EIGHTXBET_READY_SELECTOR, { timeout: 20_000 }).then(
      () => true,
      () => false
    );
  }

  if (!ready) {
    throw new Error("8xbet incoming list did not render in time.");
  }
}

async function waitForPageSettle(page: Page) {
  await page.waitForTimeout(Math.max(envInt("COLLECT_PAGE_SETTLE_MS", 1_000), 0));
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

async function readEightXBetFixtureIDs(page: Page) {
  return page.evaluate((cardSelector) => {
    const ids = Array.from(document.querySelectorAll(cardSelector))
      .map((node) => node.getAttribute("data-testid") || "")
      .map((value) => {
        const match = value.match(/football-(\d+)/i);
        return match?.[1] || "";
      })
      .filter(Boolean);

    return Array.from(new Set(ids));
  }, EIGHTXBET_CARD_SELECTOR);
}

async function openEightXBetExhaustiveContent(page: Page, fixtureId: string) {
  const card = page.locator(`[data-testid="simple-handicap-layout-football-${fixtureId}"]`).first();
  await card.waitFor({ state: "visible", timeout: 15_000 });
  await card.click();
  await page.waitForSelector(EIGHTXBET_EXHAUSTIVE_CONTENT_SELECTOR, { timeout: 10_000 });
  await page.waitForSelector(
    `${EIGHTXBET_EXHAUSTIVE_CONTENT_SELECTOR} button[data-testid^="oddsBtn-1|${fixtureId}|"]`,
    { timeout: 10_000 }
  );
  await waitForPageSettle(page);
}

async function installEightXBetObserver(page: Page) {
  await page.evaluate(
    ({ cardSelector, oddsSelector }) => {
      const win = window as typeof window & {
        __surebet_8xbet_stream__?: {
          version: number;
          observer?: MutationObserver;
        };
      };
      const state = win.__surebet_8xbet_stream__ ?? { version: 0 };
      state.observer?.disconnect();
      state.version = 0;

      const firstCard = document.querySelector(cardSelector);
      const root =
        firstCard?.parentElement?.parentElement ??
        firstCard?.parentElement ??
        document.querySelector(oddsSelector)?.parentElement ??
        document.body;

      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === "characterData") {
            state.version += 1;
            return;
          }
          if (mutation.type === "attributes") {
            state.version += 1;
            return;
          }
          if (
            mutation.type === "childList" &&
            (mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0)
          ) {
            state.version += 1;
            return;
          }
        }
      });

      observer.observe(root, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["class", "data-testid", "disabled", "aria-disabled"]
      });

      state.observer = observer;
      win.__surebet_8xbet_stream__ = state;
    },
    {
      cardSelector: EIGHTXBET_CARD_SELECTOR,
      oddsSelector: EIGHTXBET_ODDS_BUTTON_SELECTOR
    }
  );
}

async function readEightXBetObserverVersion(page: Page) {
  return page.evaluate(() => {
    const win = window as typeof window & {
      __surebet_8xbet_stream__?: {
        version?: number;
      };
    };
    return win.__surebet_8xbet_stream__?.version ?? 0;
  });
}

function emptyEightXBetSnapshot(collectorId: string): OddsSnapshot {
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

function isEightXBetSignalResponse(response: Response) {
  const resourceType = response.request().resourceType();
  if (resourceType !== "xhr" && resourceType !== "fetch") {
    return false;
  }

  return isEightXBetSignalURL(response.url());
}

function isEightXBetSignalSocket(url: string) {
  return isEightXBetSignalURL(url);
}

function isEightXBetSignalURL(value: string) {
  const url = value.toLowerCase();
  if (
    url.includes("google") ||
    url.includes("facebook") ||
    url.includes("tiktok") ||
    url.includes("cloudflare") ||
    url.includes("analytics")
  ) {
    return false;
  }

  return (
    url.includes("betgenius") ||
    url.includes("betstream") ||
    url.includes("stream.") ||
    url.includes("/sport") ||
    url.includes("/event") ||
    url.includes("/match") ||
    url.includes("/odds") ||
    url.includes("/fixture") ||
    url.includes("/api/")
  );
}

function logEightXBetTelemetry(collectorId: string, type: string, details: string) {
  if (!envBool("EIGHTXBET_STREAM_TELEMETRY", true)) {
    return;
  }

  console.log(`[${collectorId}] telemetry type=${type} ${details}`);
}

function truncateURL(value: string) {
  return value.length <= 180 ? value : `${value.slice(0, 177)}...`;
}

async function stabilizeIncomingList(page: Page) {
  let previousState = await readIncomingListState(page);
  let stableRounds = 0;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    await page.waitForTimeout(450);

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

    previousState = currentState;
  }

  return previousState;
}

type EightXBetIncomingListState = {
  cardCount: number;
  oddsButtonCount: number;
  teamLabelCount: number;
};

async function readIncomingListState(page: Page): Promise<EightXBetIncomingListState> {
  return page.evaluate(
    ({ cardSelector, oddsSelector, teamSelector }) => {
      return {
        cardCount: document.querySelectorAll(cardSelector).length,
        oddsButtonCount: document.querySelectorAll(oddsSelector).length,
        teamLabelCount: document.querySelectorAll(teamSelector).length
      };
    },
    {
      cardSelector: EIGHTXBET_CARD_SELECTOR,
      oddsSelector: EIGHTXBET_ODDS_BUTTON_SELECTOR,
      teamSelector: EIGHTXBET_TEAM_SELECTOR
    }
  );
}
