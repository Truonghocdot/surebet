import type {
  CollectContext,
  CollectorRuntime,
  OddsSnapshot,
  QuoteConfirmationRequest,
  QuoteConfirmationResult
} from "../contracts.js";
import { collectorLaunchOptions } from "../core/browser.js";
import { writeDebugArtifacts } from "../core/debug.js";
import { envInt } from "../core/env.js";
import { installCollectorResourceBlocking } from "../core/resource-blocking.js";
import { EightXBetNetworkFeed } from "./eightxbet-network-feed.js";
import { EightXBetTrafficRecorder } from "./eightxbet-traffic-recorder.js";
import { streamPollIntervalMs } from "./streaming-utils.js";
import type { Browser, BrowserContext, Page } from "playwright";
import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";

const EIGHTXBET_INPLAY_PATH = "/sportEvents/inplay/football";
const EIGHTXBET_READY_SELECTOR = '[data-testid^="simple-handicap-layout-football-"]';
const EIGHTXBET_CARD_SELECTOR = '[data-testid^="simple-handicap-layout-football-"]';
const EIGHTXBET_ODDS_BUTTON_SELECTOR = 'button[data-testid^="oddsBtn-"]';

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
      await this.refreshNetworkSubscriptions(page, targetURL);
      return this.waitForNetworkBootstrap(page);
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
      await this.refreshNetworkSubscriptions(page, targetURL);
      let snapshot = await this.waitForNetworkBootstrap(page);
      await onSnapshot(snapshot, "bootstrap");

      this.networkFeed.activate(snapshot, async (fixtureSnapshot, fixtureId) => {
        await onFixtureSnapshot?.(fixtureSnapshot, "delta", fixtureId);
      });

      await installEightXBetObserver(page);
      let lastReconcileAt = Date.now();

      while (!page.isClosed()) {
        if (Date.now() - lastReconcileAt >= eightXBetReconcileIntervalMs()) {
          await this.refreshNetworkSubscriptions(page, targetURL);
          await this.networkFeed.flush();
          snapshot = this.networkFeed.overlaySnapshot(emptyEightXBetSnapshot(this.collectorId));
          await onSnapshot(snapshot, "bootstrap");
          await installEightXBetObserver(page);
          lastReconcileAt = Date.now();
          continue;
        }

        const changedFixtureIds = await drainEightXBetChangedFixtureIDs(page);
        if (changedFixtureIds.length > 0) {
          await addEightXBetFixtureSubscriptions(page, changedFixtureIds);
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

  async confirmQuote(request: QuoteConfirmationRequest): Promise<QuoteConfirmationResult> {
    const page = this.page;
    if (!page || page.isClosed()) {
      throw new Error("8xbet in-play page is not available for confirmation");
    }

    const nextSnapshot = this.networkFeed.waitForNextFixtureSnapshot(
      request.fixtureId,
      request.timeoutMs
    );
    try {
      await refreshEightXBetFixtureSubscriptions(page, [request.fixtureId]);
      const snapshot = await nextSnapshot;
      const selection = snapshot.selections.find(
        (item) =>
          item.fixtureId === request.fixtureId &&
          item.marketId === request.marketId &&
          item.outcomeId === request.outcomeId
      );
      return {
        observedAt: snapshot.collectedAt,
        selection: selection ?? null
      };
    } catch (error) {
      void nextSnapshot.catch(() => undefined);
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
    await installEightXBetSocketSubscriptionBridge(context);

    const page = await context.newPage();
    this.detachNetworkFeed = this.networkFeed.attach(page);
    this.detachTrafficRecorder = this.trafficRecorder.attach(page);
    this.context = context;
    this.page = page;
    this.targetURL = targetURL;

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

  private async refreshNetworkSubscriptions(page: Page, targetURL: string) {
    await waitForEightXBetReady(page, targetURL);

    const fixtureIds = await readEightXBetFixtureIDs(page);
    await setEightXBetFixtureSubscriptions(page, fixtureIds);
    this.networkFeed.retainFixtures(fixtureIds);
  }

  private async waitForNetworkBootstrap(page: Page) {
    const deadline = Date.now() + Math.max(envInt("EIGHTXBET_NETWORK_BOOTSTRAP_MS", 5_000), 0);
    let snapshot = this.networkFeed.overlaySnapshot(emptyEightXBetSnapshot(this.collectorId));

    while (!page.isClosed() && snapshot.selections.length === 0 && Date.now() < deadline) {
      await page.waitForTimeout(Math.min(streamPollIntervalMs(), 250));
      await this.networkFeed.flush();
      snapshot = this.networkFeed.overlaySnapshot(emptyEightXBetSnapshot(this.collectorId));
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
    throw new Error("8xbet in-play list did not render in time.");
  }
}

async function waitForPageSettle(page: Page) {
  await page.waitForTimeout(Math.max(envInt("COLLECT_PAGE_SETTLE_MS", 1_000), 0));
}

function resolveEightXBetTargetURL(value: string) {
  const parsed = new URL(value);
  if (parsed.pathname.includes(EIGHTXBET_INPLAY_PATH)) {
    return parsed.toString();
  }

  return new URL(EIGHTXBET_INPLAY_PATH, parsed).toString();
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
      __surebetRefreshEightXBetFixtureSubscriptions?: (fixtureIDs: string[]) => void;
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
    bridgeWindow.__surebetRefreshEightXBetFixtureSubscriptions = (fixtureIDs) => {
      const validFixtureIDs = fixtureIDs.filter((fixtureID) => /^\d+$/.test(fixtureID));
      for (const fixtureID of validFixtureIDs) {
        desiredFixtureIDs.add(fixtureID);
      }
      for (const socket of sockets) {
        if (!connectedSockets.has(socket) || socket.readyState !== nativeWebSocket.OPEN) {
          continue;
        }
        const active = subscribedFixtureIDs.get(socket) ?? new Set<string>();
        for (const fixtureID of validFixtureIDs) {
          if (active.has(fixtureID)) {
            sendFrame(socket, `UNSUBSCRIBE\nid:${subscriptionID(fixtureID)}`);
            active.delete(fixtureID);
          }
        }
        subscribedFixtureIDs.set(socket, active);
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

async function refreshEightXBetFixtureSubscriptions(page: Page, fixtureIDs: string[]) {
  await page.evaluate((ids) => {
    (window as typeof window & {
      __surebetRefreshEightXBetFixtureSubscriptions?: (fixtureIDs: string[]) => void;
    }).__surebetRefreshEightXBetFixtureSubscriptions?.(ids);
  }, fixtureIDs);
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

function eightXBetReconcileIntervalMs() {
  return Math.max(envInt("EIGHTXBET_RECONCILE_MS", 5 * 60_000), 60_000);
}
