import type {
  CollectContext,
  OddsDelta,
  OddsSnapshot,
  QuoteConfirmationRequest,
  QuoteConfirmationResult
} from "../contracts.js";
import { collectorLaunchOptions } from "../core/browser.js";
import { writeDebugArtifacts } from "../core/debug.js";
import { envInt } from "../core/env.js";
import { installCollectorResourceBlocking } from "../core/resource-blocking.js";
import {
  EightXBetNetworkFeed,
  type EightXBetOddsFormatDiagnostics
} from "./eightxbet-network-feed.js";
import { EightXBetTrafficRecorder } from "./eightxbet-traffic-recorder.js";
import { streamPollIntervalMs } from "./streaming-utils.js";
import type { Browser, BrowserContext, Page } from "playwright";
import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";

const EIGHTXBET_INPLAY_PATH = "/sportEvents/inplay/football";
const EIGHTXBET_MINE_PATH = "/mine";
const EIGHTXBET_READY_SELECTOR = '[data-testid^="simple-handicap-layout-football-"]';

chromium.use(stealth());

let sharedBrowser: Browser | null = null;
let sharedBrowserPromise: Promise<Browser> | null = null;

export class EightXBetRuntime {
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private targetURL = "";
  private shutdownRequested = false;
  private detachTrafficRecorder: (() => void) | null = null;
  private readonly trafficRecorder = new EightXBetTrafficRecorder();
  private detachNetworkFeed: (() => void) | null = null;
  private readonly networkFeed: EightXBetNetworkFeed;
  private readonly confirmationSnapshots = new Map<string, Promise<OddsSnapshot>>();
  private oddsFormatAction = "unchanged";
  private oddsFormatLabel = "unknown";

  constructor(private readonly collectorId: string) {
    this.networkFeed = new EightXBetNetworkFeed(collectorId);
  }

  async streamSnapshots(
    context: CollectContext,
    onSnapshot: (snapshot: OddsSnapshot, mode: "bootstrap" | "delta") => Promise<void>,
    onFixtureDeltas?: (
      deltas: OddsDelta[],
      fixtureId: string
    ) => Promise<void>
  ) {
    this.shutdownRequested = false;
    const targetURL = resolveEightXBetTargetURL(context.pageURL);
    const page = await this.ensurePage(targetURL);

    try {
      await this.prepareNetworkFeed(page, targetURL);
      let snapshot = await this.waitForNetworkBootstrap(page);
      await onSnapshot(snapshot, "bootstrap");

      this.networkFeed.activate(
        snapshot,
        async (deltas, fixtureId) => {
          await onFixtureDeltas?.(deltas, fixtureId);
        },
        async (fixtureIds) => {
          await setEightXBetFixtureSubscriptions(page, fixtureIds);
        }
      );
      let lastReconcileAt = Date.now();

      while (!page.isClosed()) {
        assertEightXBetOddsFormatHealthy(this.networkFeed.oddsFormatDiagnostics());
        if (Date.now() - lastReconcileAt >= eightXBetReconcileIntervalMs()) {
          await this.refreshNetworkSubscriptions(page, targetURL);
          await this.networkFeed.flush();
          assertEightXBetOddsFormatHealthy(this.networkFeed.oddsFormatDiagnostics());
          snapshot = this.networkFeed.overlaySnapshot(emptyEightXBetSnapshot(this.collectorId));
          await onSnapshot(snapshot, "bootstrap");
          lastReconcileAt = Date.now();
          continue;
        }

        await sleep(Math.min(Math.max(streamPollIntervalMs(), 250), 1_000));
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
    const context = this.context;
    if (!page || page.isClosed() || !context) {
      throw new Error("8xbet in-play page is not available for confirmation");
    }

    const snapshot = await this.confirmFixtureSnapshot(context, request.fixtureId, request.timeoutMs);
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
  }

  private confirmFixtureSnapshot(
    context: BrowserContext,
    fixtureId: string,
    timeoutMs: number
  ) {
    const existing = this.confirmationSnapshots.get(fixtureId);
    if (existing) {
      return existing;
    }

    const operation = this.fetchFixtureSnapshot(context, fixtureId, timeoutMs);
    this.confirmationSnapshots.set(fixtureId, operation);
    const clear = () => {
      if (this.confirmationSnapshots.get(fixtureId) === operation) {
        this.confirmationSnapshots.delete(fixtureId);
      }
    };
    void operation.then(clear, clear);
    return operation;
  }

  private async fetchFixtureSnapshot(
    context: BrowserContext,
    fixtureId: string,
    timeoutMs: number
  ) {
    const endpoint = this.networkFeed.hardConfirmationURL(fixtureId);
    if (!endpoint) {
      throw new Error("8xbet hard confirmation is unavailable or odds format is unsupported");
    }

    const response = await context.request.get(endpoint, {
      timeout: Math.max(Math.min(timeoutMs, 2_000), 250),
      headers: {
        Accept: "application/json",
        "Accept-Language": "en-us"
      }
    });
    if (!response.ok()) {
      throw new Error(`8xbet hard confirmation returned HTTP ${response.status()}`);
    }
    const payload = await response.json().catch(() => null);
    const snapshot = await this.networkFeed.applyFullMatchPayload(payload);
    if (!snapshot || snapshot.source.bookmakerId !== "8xbet") {
      throw new Error(`8xbet hard confirmation returned an invalid fixture ${fixtureId}`);
    }
    return snapshot;
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

    try {
      await page.goto(targetURL, { waitUntil: "domcontentloaded" });
      await waitForEightXBetReady(page, targetURL);
      await this.ensureMalayOddsUI(page, targetURL);
      return page;
    } catch (error) {
      await writeDebugArtifacts(page, `${this.collectorId}-odds-format-gate-failed`);
      await this.resetPage(true);
      throw error;
    }
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

    const fixtureIds = await this.waitForMetadataFixtureIds(page);
    await setEightXBetFixtureSubscriptions(page, fixtureIds);
  }

  private async prepareNetworkFeed(page: Page, targetURL: string) {
    await this.refreshNetworkSubscriptions(page, targetURL);
    const diagnostics = await waitForEightXBetExpectedOddsFormat(page, this.networkFeed);
    logEightXBetOddsFormat("after", this.oddsFormatLabel, diagnostics, this.oddsFormatAction);
  }

  private async ensureMalayOddsUI(page: Page, targetURL: string) {
    await waitForEightXBetOddsObservation(page, this.networkFeed, 1_500);
    let location: "inplay" | "mine" = "inplay";
    let label = await waitForEightXBetOddsFormatLabel(page, 2_000);
    if (!label) {
      location = "mine";
      await page.goto(new URL(EIGHTXBET_MINE_PATH, targetURL).toString(), {
        waitUntil: "domcontentloaded"
      });
      await waitForPageSettle(page);
      label = await waitForEightXBetOddsFormatLabel(page, 5_000);
    }

    const before = this.networkFeed.oddsFormatDiagnostics();
    logEightXBetOddsFormat("before", label || "unknown", before, "inspect");
    if (!label) {
      throw new Error("8xbet source unhealthy: odds format dropdown was not found");
    }

    let changed = false;
    if (!isMalayOddsFormatLabel(label)) {
      await selectEightXBetMalayOdds(page, label);
      const selectedLabel = await waitForEightXBetMalayOddsFormatLabel(page, 5_000);
      if (!selectedLabel) {
        throw new Error(`8xbet source unhealthy: Malay odds selection did not persist (was ${label})`);
      }
      label = selectedLabel;
      changed = true;
    }
    this.oddsFormatLabel = label;

    if (changed || location === "mine") {
      this.oddsFormatAction = changed ? "changed" : "mine-verified";
      this.networkFeed.resetOddsFormatObservation(true);
      await page.goto(targetURL, { waitUntil: "domcontentloaded" });
      await waitForEightXBetReady(page, targetURL);
    } else {
      this.oddsFormatAction = "unchanged";
    }
  }

  private async waitForMetadataFixtureIds(page: Page) {
    const timeoutMs = Math.max(envInt("EIGHTXBET_METADATA_BOOTSTRAP_MS", 5_000), 1_000);
    const deadline = Date.now() + timeoutMs;
    while (!page.isClosed() && Date.now() < deadline) {
      const fixtureIds = this.networkFeed.activeFixtureIds();
      if (fixtureIds !== null) {
        return fixtureIds;
      }
      await sleep(50);
    }
    throw new Error("8xbet in-play metadata did not arrive in time.");
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

const eightXBetOddsFormatLabels = [
  "Kèo Châu Âu",
  "Kèo Hồng Kông",
  "Kèo Malay",
  "Kèo Indo",
  "Euro Odds",
  "European Odds",
  "Hong Kong Odds",
  "Malay Odds",
  "Indonesian Odds",
  "Malay",
  "Indo"
];

async function waitForEightXBetOddsFormatLabel(page: Page, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (!page.isClosed() && Date.now() < deadline) {
    const label = await readEightXBetOddsFormatLabel(page);
    if (label) {
      return label;
    }
    await page.waitForTimeout(100);
  }
  return "";
}

async function waitForEightXBetMalayOddsFormatLabel(page: Page, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (!page.isClosed() && Date.now() < deadline) {
    const label = await readEightXBetOddsFormatLabel(page);
    if (isMalayOddsFormatLabel(label)) {
      return label;
    }
    await page.waitForTimeout(100);
  }
  return "";
}

export async function readEightXBetOddsFormatLabel(page: Page) {
  const known = new Set(eightXBetOddsFormatLabels.map(normalizeEightXBetOddsFormatLabel));
  const labels = await page
    .locator("div.cursor-pointer:visible span:visible")
    .allTextContents()
    .catch(() => []);
  for (const value of labels) {
    const label = value.replace(/\s+/g, " ").trim();
    if (known.has(normalizeEightXBetOddsFormatLabel(label))) {
      return label;
    }
  }
  return "";
}

async function selectEightXBetMalayOdds(page: Page, currentLabel: string) {
  const currentPattern = new RegExp(`^\\s*${escapeRegularExpression(currentLabel)}\\s*$`, "i");
  const toggle = page.locator("div.cursor-pointer").filter({ hasText: currentPattern }).first();
  if ((await toggle.count()) === 0 || !(await toggle.isVisible())) {
    throw new Error(`8xbet source unhealthy: odds format toggle ${currentLabel} is not clickable`);
  }
  await toggle.click({ timeout: 5_000 });

  for (const label of ["Kèo Malay", "Malay Odds", "Malay"]) {
    const option = page.getByRole("button", { name: label, exact: true }).first();
    if ((await option.count()) > 0 && (await option.isVisible())) {
      await option.click({ timeout: 5_000 });
      return;
    }
  }
  throw new Error("8xbet source unhealthy: Malay odds option was not found after opening the dropdown");
}

async function waitForEightXBetExpectedOddsFormat(
  page: Page,
  feed: EightXBetNetworkFeed
) {
  const timeoutMs = Math.max(envInt("EIGHTXBET_ODDS_FORMAT_GATE_MS", 5_000), 1_000);
  const deadline = Date.now() + timeoutMs;
  while (!page.isClosed() && Date.now() < deadline) {
    const diagnostics = feed.oddsFormatDiagnostics();
    assertEightXBetOddsFormatHealthy(diagnostics);
    if (diagnostics.healthy) {
      return diagnostics;
    }
    await page.waitForTimeout(50);
  }
  const diagnostics = feed.oddsFormatDiagnostics();
  throw new Error(
    `8xbet source unhealthy: pd1 format was not confirmed within ${timeoutMs}ms ` +
    `(destination=${diagnostics.destination || "none"} raw=${formatRawOddsSamples(diagnostics)})`
  );
}

async function waitForEightXBetOddsObservation(
  page: Page,
  feed: EightXBetNetworkFeed,
  timeoutMs: number
) {
  const deadline = Date.now() + timeoutMs;
  while (!page.isClosed() && Date.now() < deadline) {
    if (feed.oddsFormatDiagnostics().observationCount > 0) {
      return;
    }
    await page.waitForTimeout(50);
  }
}

function assertEightXBetOddsFormatHealthy(diagnostics: EightXBetOddsFormatDiagnostics) {
  if (diagnostics.unhealthyReason) {
    throw new Error(
      `8xbet source unhealthy: ${diagnostics.unhealthyReason} ` +
      `(destination=${diagnostics.destination || "none"} raw=${formatRawOddsSamples(diagnostics)})`
    );
  }
}

function logEightXBetOddsFormat(
  stage: "before" | "after",
  label: string,
  diagnostics: EightXBetOddsFormatDiagnostics,
  action: string
) {
  console.log(
    `[8xbet-format] stage=${stage} action=${action} label=${JSON.stringify(label)} ` +
    `destination=${diagnostics.destination || "none"} suffix=${diagnostics.priceDisplay || "none"} ` +
    `raw_odds=${formatRawOddsSamples(diagnostics)} healthy=${diagnostics.healthy}`
  );
}

function formatRawOddsSamples(diagnostics: EightXBetOddsFormatDiagnostics) {
  return diagnostics.rawOddsSamples.length > 0
    ? diagnostics.rawOddsSamples.join(",")
    : "none";
}

function isMalayOddsFormatLabel(value: string) {
  return /(?:^|\s)malay(?:\s|$)/i.test(value.trim());
}

function normalizeEightXBetOddsFormatLabel(value: string) {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function escapeRegularExpression(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveEightXBetTargetURL(value: string) {
  const parsed = new URL(value);
  if (parsed.pathname.includes(EIGHTXBET_INPLAY_PATH)) {
    return parsed.toString();
  }

  return new URL(EIGHTXBET_INPLAY_PATH, parsed).toString();
}

async function installEightXBetSocketSubscriptionBridge(context: BrowserContext) {
  await context.addInitScript(({ batchSize, batchDelayMs }) => {
    const nativeWebSocket = window.WebSocket;
    const desiredFixtureIDs = new Set<string>();
    const sockets = new Set<WebSocket>();
    const connectedSockets = new WeakSet<WebSocket>();
    const subscribedFixtureIDs = new WeakMap<WebSocket, Set<string>>();
    const subscriptionQueues = new WeakMap<
      WebSocket,
      { pending: Set<string>; timer: number | null }
    >();

    const isSportsSocket = (url: string) => {
      return url.includes("/websocket/ws") && /gw-nwwss/i.test(url);
    };
    const subscriptionID = (fixtureID: string) => `surebet-odds-${fixtureID}`;
    const sendFrame = (socket: WebSocket, frame: string) => {
      try {
        socket.send(`${frame}\n\n\u0000`);
        return true;
      } catch {
        // The bridge subscribes again after the site reconnects its socket.
        return false;
      }
    };
    const queueState = (socket: WebSocket) => {
      const current = subscriptionQueues.get(socket);
      if (current) return current;
      const created = { pending: new Set<string>(), timer: null as number | null };
      subscriptionQueues.set(socket, created);
      return created;
    };
    const drainSubscriptionQueue = (socket: WebSocket) => {
      const queue = queueState(socket);
      queue.timer = null;
      if (!connectedSockets.has(socket) || socket.readyState !== nativeWebSocket.OPEN) {
        return;
      }

      const active = subscribedFixtureIDs.get(socket) ?? new Set<string>();
      let sent = 0;
      for (const fixtureID of Array.from(queue.pending)) {
        queue.pending.delete(fixtureID);
        if (!desiredFixtureIDs.has(fixtureID) || active.has(fixtureID)) {
          continue;
        }
        const sentFrame = sendFrame(
          socket,
          `SUBSCRIBE\nid:${subscriptionID(fixtureID)}\ndestination:/topic/odds-diff/match/${fixtureID}`
        );
        if (sentFrame) {
          active.add(fixtureID);
          sent += 1;
        } else {
          queue.pending.add(fixtureID);
          break;
        }
        if (sent >= batchSize) break;
      }
      subscribedFixtureIDs.set(socket, active);
      if (queue.pending.size > 0) {
        queue.timer = window.setTimeout(
          () => drainSubscriptionQueue(socket),
          batchDelayMs
        );
      }
    };
    const scheduleSubscriptionDrain = (socket: WebSocket) => {
      const queue = queueState(socket);
      if (queue.timer !== null || queue.pending.size === 0) return;
      queue.timer = window.setTimeout(() => drainSubscriptionQueue(socket), 0);
    };
    const syncSubscriptions = (socket: WebSocket) => {
      if (!connectedSockets.has(socket) || socket.readyState !== nativeWebSocket.OPEN) {
        return;
      }

      const active = subscribedFixtureIDs.get(socket) ?? new Set<string>();
      const queue = queueState(socket);
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
        queue.pending.add(fixtureID);
      }
      for (const fixtureID of Array.from(queue.pending)) {
        if (!desiredFixtureIDs.has(fixtureID)) queue.pending.delete(fixtureID);
      }
      subscribedFixtureIDs.set(socket, active);
      scheduleSubscriptionDrain(socket);
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
          const queue = subscriptionQueues.get(this);
          if (queue && queue.timer !== null) window.clearTimeout(queue.timer);
          sockets.delete(this);
        });
      }
    }

    window.WebSocket = TrackedWebSocket as typeof WebSocket;
    const bridgeWindow = window as typeof window & {
      __surebetSetEightXBetFixtureSubscriptions?: (fixtureIDs: string[]) => void;
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
  }, {
    batchSize: eightXBetSubscriptionBatchSize(),
    batchDelayMs: eightXBetSubscriptionBatchDelayMs()
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

function eightXBetSubscriptionBatchSize() {
  return Math.min(Math.max(envInt("EIGHTXBET_SUBSCRIPTION_BATCH_SIZE", 4), 1), 20);
}

function eightXBetSubscriptionBatchDelayMs() {
  return Math.max(envInt("EIGHTXBET_SUBSCRIPTION_BATCH_DELAY_MS", 250), 50);
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
