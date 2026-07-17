import type { CollectContext, CollectorRuntime, OddsSnapshot } from "../contracts.js";
import { collectorLaunchOptions } from "../core/browser.js";
import { writeDebugArtifacts } from "../core/debug.js";
import { envBool, envInt } from "../core/env.js";
import { installCollectorResourceBlocking } from "../core/resource-blocking.js";
import { EightXBetNetworkFeed } from "./eightxbet-network-feed.js";
import { EightXBetTrafficRecorder } from "./eightxbet-traffic-recorder.js";
import { parseEightXBetExhaustiveSnapshot } from "./parsers/eightxbet-exhaustive-parser.js";
import { streamPollIntervalMs } from "./streaming-utils.js";
import type { Browser, BrowserContext, Page } from "playwright";
import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";

const EIGHTXBET_INCOMING_PATH = "/sportEvents/incoming/football?hour=6";
const EIGHTXBET_PREFERENCES_PATH = "/mine";
const EIGHTXBET_READY_SELECTOR = '[data-testid^="simple-handicap-layout-football-"]';
const EIGHTXBET_CARD_SELECTOR = '[data-testid^="simple-handicap-layout-football-"]';
const EIGHTXBET_ODDS_BUTTON_SELECTOR = 'button[data-testid^="oddsBtn-"]';
const EIGHTXBET_EXHAUSTIVE_CONTENT_SELECTOR = '[data-testid="ExhaustiveContentV4"]';

type EightXBetExhaustiveOpenResult = "opened" | "missing_card" | "no_market";

chromium.use(stealth());

let sharedBrowser: Browser | null = null;
let sharedBrowserPromise: Promise<Browser> | null = null;

export class EightXBetRuntime implements CollectorRuntime {
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private targetURL = "";
  private shutdownRequested = false;
  private detachTrafficRecorder: (() => void) | null = null;
  private readonly trafficRecorder = new EightXBetTrafficRecorder();
  private detachNetworkFeed: (() => void) | null = null;
  private readonly networkFeed: EightXBetNetworkFeed;

  constructor(private readonly collectorId: string) {
    this.networkFeed = new EightXBetNetworkFeed(collectorId);
  }

  async collect(context: CollectContext) {
    this.shutdownRequested = false;
    const targetURL = resolveEightXBetTargetURL(context.pageURL);
    const page = await this.ensurePage(targetURL);

    try {
      return this.networkFeed.overlaySnapshot(await this.readSnapshot(page, targetURL));
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
    onSnapshot: (snapshot: OddsSnapshot, mode: "bootstrap" | "delta") => Promise<void>,
    onFixtureSnapshot?: (
      snapshot: OddsSnapshot,
      mode: "bootstrap" | "delta",
      fixtureId: string
    ) => Promise<void>
  ) {
    this.shutdownRequested = false;
    const targetURL = resolveEightXBetTargetURL(context.pageURL);
    const page = await this.ensurePage(targetURL);

    try {
      let snapshot = this.networkFeed.overlaySnapshot(await this.readSnapshot(page, targetURL));
      while (!page.isClosed() && snapshot.selections.length === 0) {
        await page.waitForTimeout(Math.max(streamPollIntervalMs(), 250));
        snapshot = this.networkFeed.overlaySnapshot(await this.readSnapshot(page, targetURL));
      }
      await onSnapshot(snapshot, "bootstrap");

      this.networkFeed.activate(snapshot, async (fixtureSnapshot, fixtureId) => {
        await onFixtureSnapshot?.(fixtureSnapshot, "delta", fixtureId);
      });

      await installEightXBetObserver(page);
      let lastReconcileAt = Date.now();

      while (!page.isClosed()) {
        if (Date.now() - lastReconcileAt >= eightXBetReconcileIntervalMs()) {
          snapshot = await this.readSnapshot(page, targetURL, { forceExhaustive: true });
          if (snapshot.selections.length === 0) {
            await installEightXBetObserver(page);
            lastReconcileAt = Date.now();
            continue;
          }
          snapshot = this.networkFeed.overlaySnapshot(snapshot);
          await onSnapshot(snapshot, "bootstrap");
          await installEightXBetObserver(page);
          lastReconcileAt = Date.now();
          continue;
        }

        const changedFixtureIds = await drainEightXBetChangedFixtureIDs(page);
        for (const fixtureId of changedFixtureIds) {
          await addEightXBetFixtureSubscriptions(page, [fixtureId]);
          if (this.networkFeed.hasDecodedFixture(fixtureId)) {
            continue;
          }
          const fixtureSnapshot = await this.readFixtureSnapshot(page, fixtureId, targetURL);
          if (fixtureSnapshot.selections.length > 0) {
            await onFixtureSnapshot?.(fixtureSnapshot, "delta", fixtureId);
          }
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
      this.networkFeed.deactivate();
      await this.networkFeed.flush();
    }
  }

  async close() {
    this.shutdownRequested = true;
    await this.resetPage(true);
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
    await installEightXBetSocketSubscriptionBridge(context);

    const page = await context.newPage();
    this.detachNetworkFeed = this.networkFeed.attach(page);
    this.detachTrafficRecorder = this.trafficRecorder.attach(page);
    this.context = context;
    this.page = page;
    this.targetURL = targetURL;

    await bootstrapEightXBetPreferences(page, targetURL);
    await page.goto(targetURL, { waitUntil: "domcontentloaded" });
    return page;
  }

  private async resetPage(closeBrowser = false) {
    const context = this.context;
    this.context = null;
    this.page = null;
    this.targetURL = "";
    this.detachTrafficRecorder?.();
    this.detachTrafficRecorder = null;
    this.detachNetworkFeed?.();
    this.detachNetworkFeed = null;
    await context?.close().catch(() => undefined);
    await this.networkFeed.flush();
    await this.trafficRecorder.flush();
    if (closeBrowser) {
      await closeSharedBrowser();
    }
  }

  private async readSnapshot(
    page: Page,
    targetURL: string,
    options?: {
      mode?: "bootstrap" | "delta";
      forceExhaustive?: boolean;
      onFixtureSnapshot?: (
        snapshot: OddsSnapshot,
        mode: "bootstrap" | "delta",
        fixtureId: string
      ) => Promise<void>;
    }
  ): Promise<OddsSnapshot> {
    await waitForEightXBetReady(page, targetURL);

    const fixtureIds = await readEightXBetFixtureIDs(page);
    await setEightXBetFixtureSubscriptions(page, fixtureIds);
    this.networkFeed.retainFixtures(fixtureIds);
    const selections: OddsSnapshot["selections"] = [];
    let recoverableSkipCount = 0;

    for (const fixtureId of fixtureIds) {
      if (
        !options?.forceExhaustive &&
        (await primeEightXBetNetworkFixture(page, fixtureId, targetURL, this.networkFeed))
      ) {
        continue;
      }
      const snapshot = await this.readFixtureSnapshot(page, fixtureId, targetURL);
      if (snapshot.selections.length === 0) {
        recoverableSkipCount += 1;
        continue;
      }
      if (options?.onFixtureSnapshot && options.mode) {
        await options.onFixtureSnapshot(snapshot, options.mode, fixtureId);
      }
      selections.push(...snapshot.selections);
    }

    if (selections.length === 0) {
      if (
        recoverableSkipCount > 0 ||
        fixtureIds.some((fixtureId) => this.networkFeed.hasDecodedFixture(fixtureId))
      ) {
        return emptyEightXBetSnapshot(this.collectorId);
      }
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

  private async readFixtureSnapshot(page: Page, fixtureId: string, targetURL: string) {
    const openResult = await openEightXBetExhaustiveContent(
      page,
      fixtureId,
      targetURL,
      this.collectorId
    );
    if (openResult !== "opened") {
      return emptyEightXBetSnapshot(this.collectorId);
    }

    const sectionHtml = await extractEightXBetSectionHtml(page, fixtureId);
    const snapshot = parseEightXBetExhaustiveSnapshot(
      sectionHtml,
      page.url(),
      this.collectorId,
      fixtureId
    );
    if (snapshot.selections.length === 0 && !(await isEightXBetNoMarketVisible(page))) {
      logEightXBetTelemetry(this.collectorId, "exhaustive_empty", `fixture=${fixtureId}`);
    }
    return snapshot;
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

async function installEightXBetSocketSubscriptionBridge(context: BrowserContext) {
  await context.addInitScript(() => {
    const nativeWebSocket = window.WebSocket;
    const desiredFixtureIDs = new Set<string>();
    const sockets = new Set<WebSocket>();
    const connectedSockets = new WeakSet<WebSocket>();
    const subscribedFixtureIDs = new WeakMap<WebSocket, Set<string>>();

    const isSportsSocket = (url: string) => {
      return url.includes("/websocket/ws") && /gw-nwwss/i.test(url);
    };
    const subscriptionID = (fixtureID: string) => `surebet-odds-${fixtureID}`;
    const sendFrame = (socket: WebSocket, frame: string) => {
      try {
        socket.send(`${frame}\n\n\u0000`);
      } catch {
        // The bridge subscribes again after the site reconnects its socket.
      }
    };
    const syncSubscriptions = (socket: WebSocket) => {
      if (!connectedSockets.has(socket) || socket.readyState !== nativeWebSocket.OPEN) {
        return;
      }

      const active = subscribedFixtureIDs.get(socket) ?? new Set<string>();
      for (const fixtureID of Array.from(active)) {
        if (desiredFixtureIDs.has(fixtureID)) {
          continue;
        }
        sendFrame(socket, `UNSUBSCRIBE\nid:${subscriptionID(fixtureID)}`);
        active.delete(fixtureID);
      }
      for (const fixtureID of desiredFixtureIDs) {
        if (active.has(fixtureID)) {
          continue;
        }
        sendFrame(
          socket,
          `SUBSCRIBE\nid:${subscriptionID(fixtureID)}\ndestination:/topic/odds-diff/match/${fixtureID}`
        );
        active.add(fixtureID);
      }
      subscribedFixtureIDs.set(socket, active);
    };

    class TrackedWebSocket extends nativeWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        if (protocols === undefined) {
          super(url);
        } else {
          super(url, protocols);
        }
        if (!isSportsSocket(String(url))) {
          return;
        }

        sockets.add(this);
        this.addEventListener("message", (event) => {
          if (typeof event.data !== "string" || !event.data.startsWith("CONNECTED")) {
            return;
          }
          connectedSockets.add(this);
          syncSubscriptions(this);
        });
        this.addEventListener("close", () => {
          sockets.delete(this);
        });
      }
    }

    window.WebSocket = TrackedWebSocket as typeof WebSocket;
    const bridgeWindow = window as typeof window & {
      __surebetSetEightXBetFixtureSubscriptions?: (fixtureIDs: string[]) => void;
      __surebetAddEightXBetFixtureSubscriptions?: (fixtureIDs: string[]) => void;
    };
    bridgeWindow.__surebetSetEightXBetFixtureSubscriptions = (fixtureIDs) => {
      desiredFixtureIDs.clear();
      for (const fixtureID of fixtureIDs) {
        if (/^\d+$/.test(fixtureID)) {
          desiredFixtureIDs.add(fixtureID);
        }
      }
      for (const socket of sockets) {
        syncSubscriptions(socket);
      }
    };
    bridgeWindow.__surebetAddEightXBetFixtureSubscriptions = (fixtureIDs) => {
      for (const fixtureID of fixtureIDs) {
        if (/^\d+$/.test(fixtureID)) {
          desiredFixtureIDs.add(fixtureID);
        }
      }
      for (const socket of sockets) {
        syncSubscriptions(socket);
      }
    };
  });
}

async function setEightXBetFixtureSubscriptions(page: Page, fixtureIDs: string[]) {
  await page.evaluate((ids) => {
    (window as typeof window & {
      __surebetSetEightXBetFixtureSubscriptions?: (fixtureIDs: string[]) => void;
    }).__surebetSetEightXBetFixtureSubscriptions?.(ids);
  }, fixtureIDs);
  console.log(`[8xbet-network] fixture subscriptions requested=${fixtureIDs.length}`);
}

async function addEightXBetFixtureSubscriptions(page: Page, fixtureIDs: string[]) {
  await page.evaluate((ids) => {
    (window as typeof window & {
      __surebetAddEightXBetFixtureSubscriptions?: (fixtureIDs: string[]) => void;
    }).__surebetAddEightXBetFixtureSubscriptions?.(ids);
  }, fixtureIDs);
}

async function primeEightXBetNetworkFixture(
  page: Page,
  fixtureId: string,
  targetURL: string,
  networkFeed: EightXBetNetworkFeed
) {
  if (networkFeed.hasDecodedFixture(fixtureId)) {
    return true;
  }

  const cardSelector = `[data-testid="simple-handicap-layout-football-${fixtureId}"]`;
  const card = page.locator(cardSelector).first();
  const visible = await card
    .waitFor({ state: "visible", timeout: 1_500 })
    .then(() => true, () => false);
  if (!visible) {
    return false;
  }

  const targets = [
    `${cardSelector} [data-testid="sport-inplay-timer"]`,
    `${cardSelector} [data-testid="simple-game-stage"]`,
    `${cardSelector} small.line-clamp-1.text-ellipsis.text-text-2`
  ];
  for (const selector of targets) {
    await page.locator(selector).first().click({ timeout: 1_500 }).catch(() => undefined);
    if (isEightXBetLoginURL(page.url())) {
      await recoverEightXBetInplayPage(page, targetURL);
      continue;
    }

    const deadline = Date.now() + 1_500;
    while (Date.now() < deadline) {
      if (networkFeed.hasDecodedFixture(fixtureId)) {
        return true;
      }
      await page.waitForTimeout(50);
    }
  }
  return networkFeed.hasDecodedFixture(fixtureId);
}

async function openEightXBetExhaustiveContent(
  page: Page,
  fixtureId: string,
  targetURL: string,
  collectorId: string
): Promise<EightXBetExhaustiveOpenResult> {
  const cardSelector = `[data-testid="simple-handicap-layout-football-${fixtureId}"]`;
  const attempts: Array<
    | {
        name: string;
        kind: "locator";
        selector: string;
      }
    | {
        name: string;
        kind: "position";
        xRatio: number;
        yRatio: number;
      }
  > = [
    {
      name: "inplay_timer",
      kind: "locator",
      selector: `${cardSelector} [data-testid="sport-inplay-timer"]`
    },
    {
      name: "game_stage",
      kind: "locator",
      selector: `${cardSelector} [data-testid="simple-game-stage"]`
    },
    {
      name: "team_label",
      kind: "locator",
      selector: `${cardSelector} small.line-clamp-1.text-ellipsis.text-text-2`
    },
    {
      name: "card_top_left",
      kind: "position",
      xRatio: 0.14,
      yRatio: 0.18
    },
    {
      name: "card_left_body",
      kind: "position",
      xRatio: 0.18,
      yRatio: 0.56
    }
  ];

  for (const attempt of attempts) {
    const card = page.locator(cardSelector).first();
    const cardVisible = await card
      .waitFor({ state: "visible", timeout: 2_000 })
      .then(() => true, () => false);
    if (!cardVisible) {
      return "missing_card";
    }

    try {
      if (attempt.kind === "locator") {
        // Phase 4: reduced click timeout — fail fast and try next attempt
        await page.locator(attempt.selector).first().click({ timeout: 2_000 });
      } else {
        const box = await card.boundingBox();
        if (!box) {
          throw new Error("fixture card is not measurable");
        }

        const x = clampClickOffset(box.width, attempt.xRatio);
        const y = clampClickOffset(box.height, attempt.yRatio);
        await card.click({
          timeout: 2_000,
          position: { x, y }
        });
      }
    } catch {}

    const openResult = await waitForEightXBetExhaustiveOpen(page, fixtureId);
    if (openResult === "opened") {
      await waitForPageSettle(page);
      return "opened";
    }
    if (openResult === "no_market") {
      return "no_market";
    }

    if (isEightXBetLoginURL(page.url())) {
      await recoverEightXBetInplayPage(page, targetURL);
      continue;
    }
  }

  if (await isEightXBetNoMarketVisible(page)) {
    return "no_market";
  }
  await writeDebugArtifacts(page, `${collectorId}-exhaustive-open-failed-${fixtureId}`);
  throw new Error(`8xbet exhaustive content did not open for fixture ${fixtureId}.`);
}

async function waitForEightXBetExhaustiveOpen(page: Page, fixtureId: string) {
  // Phase 4: reduced from 2500ms → 1500ms to fail fast and try next click attempt sooner
  const contentReady = await page
    .waitForSelector(EIGHTXBET_EXHAUSTIVE_CONTENT_SELECTOR, { timeout: 1_500 })
    .then(() => true, () => false);
  if (!contentReady) {
    return "missing_card" as const;
  }

  const buttonsReady = await page
    .waitForSelector(
      `${EIGHTXBET_EXHAUSTIVE_CONTENT_SELECTOR} button[data-testid^="oddsBtn-1|${fixtureId}|"]`,
      { timeout: 1_500 }
    )
    .then(() => true, () => false);
  if (buttonsReady) {
    return "opened" as const;
  }
  if (await isEightXBetNoMarketVisible(page)) {
    return "no_market" as const;
  }
  return "missing_card" as const;
}

async function recoverEightXBetInplayPage(page: Page, targetURL: string) {
  await page.goto(targetURL, { waitUntil: "domcontentloaded" }).catch(() => undefined);
  await waitForEightXBetReady(page, targetURL);
}

function clampClickOffset(size: number, ratio: number) {
  const raw = Math.round(size * ratio);
  return Math.max(12, Math.min(raw, Math.max(Math.round(size) - 12, 12)));
}

function isEightXBetLoginURL(value: string) {
  const url = value.toLowerCase();
  return url.includes("login") || url.includes("/signin") || url.includes("/auth");
}

async function isEightXBetNoMarketVisible(page: Page) {
  const text = await page
    .locator(EIGHTXBET_EXHAUSTIVE_CONTENT_SELECTOR)
    .first()
    .textContent()
    .catch(() => "");
  return /\bno\s+market\b/i.test(text ?? "");
}

async function installEightXBetObserver(page: Page) {
  await page.evaluate(
    ({ cardSelector, oddsSelector }) => {
      const win = window as typeof window & {
        __surebet_8xbet_stream__?: {
          changedFixtureIds: string[];
          observer?: MutationObserver;
        };
      };
      const state = win.__surebet_8xbet_stream__ ?? { changedFixtureIds: [] };
      state.observer?.disconnect();
      state.changedFixtureIds = [];

      const firstCard = document.querySelector(cardSelector);
      const root =
        firstCard?.parentElement?.parentElement ??
        firstCard?.parentElement ??
        document.querySelector(oddsSelector)?.parentElement ??
        document.body;

      const changed = new Set<string>();
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          const nodes = [mutation.target, ...mutation.addedNodes, ...mutation.removedNodes];
          for (const node of nodes) {
            const element =
              node instanceof Element
                ? node
                : node?.parentElement instanceof Element
                  ? node.parentElement
                  : null;
            if (!element) continue;
            const isCardChange = element.matches(cardSelector);
            const isOddsChange =
              element.matches(oddsSelector) ||
              Boolean(element.closest(oddsSelector)) ||
              Boolean(element.querySelector(oddsSelector));
            if (!isCardChange && !isOddsChange) continue;
            const card = isCardChange ? element : element.closest(cardSelector);
            const testID = card?.getAttribute("data-testid") ?? "";
            const fixtureId = testID.match(/football-(\d+)/i)?.[1];
            if (fixtureId) changed.add(fixtureId);
          }
        }
        state.changedFixtureIds.push(...changed);
        changed.clear();
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

async function drainEightXBetChangedFixtureIDs(page: Page) {
  return page.evaluate(() => {
    const win = window as typeof window & {
      __surebet_8xbet_stream__?: {
        changedFixtureIds?: string[];
      };
    };
    const fixtureIds = Array.from(new Set(win.__surebet_8xbet_stream__?.changedFixtureIds ?? []));
    if (win.__surebet_8xbet_stream__) {
      win.__surebet_8xbet_stream__.changedFixtureIds = [];
    }
    return fixtureIds;
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

function logEightXBetTelemetry(collectorId: string, type: string, details: string) {
  if (!envBool("EIGHTXBET_STREAM_TELEMETRY", true)) {
    return;
  }

  console.log(`[${collectorId}] telemetry type=${type} ${details}`);
}

function eightXBetReconcileIntervalMs() {
  return Math.max(envInt("EIGHTXBET_RECONCILE_MS", 5 * 60_000), 60_000);
}

/**
 * Phase 2 optimisation: instead of serialising the full page HTML (~500KB–2MB)
 * via page.content() and then re-parsing it with JSDOM, we extract only the
 * three DOM sections that the exhaustive parser actually needs:
 *   1. ExhaustiveContentV4  – odds buttons
 *   2. The fixture card container – team names / handicap header
 *   3. exhaustive-navigator-v4 – league name
 *
 * This reduces the CDP payload to ~20–50KB and cuts JSDOM parse time
 * proportionally, typically saving 80–95 % of the per-fixture scrape cost.
 */
async function extractEightXBetSectionHtml(page: Page, fixtureId: string): Promise<string> {
  return page.evaluate((fid) => {
    const section = document.querySelector('[data-testid="ExhaustiveContentV4"]');
    const card = document.querySelector(
      `[data-testid="simple-handicap-layout-football-${fid}"]`
    );
    const navigatorEl = document.querySelector('[data-testid="exhaustive-navigator-v4"]');

    // Prefer the full league-unit container so the parser can resolve the
    // handicap header / league name from its usual ancestors.
    const cardContainer =
      card?.closest('[data-testid^="v4-sport-asia-simple-handicap-unit-"]') ?? card;

    const parts = [
      section?.outerHTML ?? "",
      cardContainer?.outerHTML ?? "",
      navigatorEl?.outerHTML ?? ""
    ].filter(Boolean);

    if (parts.length === 0) return "";
    return `<div data-surebet-partial="eightxbet-exhaustive">${parts.join("")}</div>`;
  }, fixtureId);
}
