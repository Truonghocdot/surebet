import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import type { Frame, Page } from "playwright";
import {
  JUN88_LOBBIES,
  collectorLaunchOptions,
  ensureEightXBetLogin,
  envString,
  resolveEightXBetInplayPageURL,
  resolveJun88CmdPageURL,
  syncCollectorRuntimeConfig,
} from "@surebet/collector-shared";
import { withJun88BookmakerPage } from "../shared/src/bookmakers/jun88-bookmaker-page.js";
import {
  extractHistoryPageSummary,
  redactText,
  redactURL,
  type HistoryPageSummary,
} from "./history-check-utils.js";

chromium.use(stealth());

const HISTORY_TIMEOUT_MS = 30_000;
const EIGHTXBET_HISTORY_PATH = "/history/order";
const JUN88_HISTORY_PATH = "/member/lists/payment_betList_new.aspx";
const JUN88_HISTORY_LINK_PATH = "bet_list_new";
const artifactRoot = path.resolve(process.cwd(), "tmp/collector/history-check");

type RequestObservation = { method: string; url: string };

type EightXBetResult = {
  bookmaker: "8xbet";
  browserLogin: "ok" | "failed";
  historyPage: "loaded" | "failed";
  historyNavigation: "observed" | "not_observed";
  httpStatus?: number;
  pageURL?: string;
  summary?: HistoryPageSummary;
  bodyPreview?: string;
  error?: string;
};

type Jun88Result = {
  bookmaker: "jun88";
  browserLogin: "ok" | "failed";
  historyPage: "loaded" | "session_timeout" | "failed";
  historyLinkClicked: boolean;
  httpStatus?: number;
  pageURL?: string;
  summary?: HistoryPageSummary;
  error?: string;
};

async function main() {
  await mkdir(artifactRoot, { recursive: true });
  await syncCollectorRuntimeConfig(envString("BACKEND_API_URL", "http://127.0.0.1:8080"), {
    source: { collectorId: "8xbet", bookmakerId: "8xbet", lobbyId: "default" },
  }).catch((error) => {
    console.warn(`[history-check] runtime config sync failed: ${errorMessage(error)}`);
  });

  const eightXBet = await checkEightXBet();
  const jun88 = await checkJun88();
  const report = { checked_at: new Date().toISOString(), eightxbet: eightXBet, jun88 };
  await writeFile(path.join(artifactRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");

  printReport(eightXBet, jun88);
  if (eightXBet.browserLogin === "failed" || jun88.browserLogin === "failed" ||
    eightXBet.historyPage !== "loaded" || jun88.historyPage !== "loaded") {
    process.exitCode = 2;
  }
}

async function checkEightXBet(): Promise<EightXBetResult> {
  const browser = await chromium.launch(await collectorLaunchOptions(false));
  const context = await browser.newContext({
    viewport: null,
    locale: "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
    extraHTTPHeaders: { "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7" },
  });
  const loginPage = await context.newPage();
  try {
    await ensureEightXBetLogin(loginPage, { inplayURL: resolveEightXBetInplayPageURL() });
    const historyPage = await context.newPage();
    const observations: RequestObservation[] = [];
    attachHistoryObservers(historyPage, EIGHTXBET_HISTORY_PATH, observations);
    const historyURL = eightXBetHistoryURL();
    const response = await historyPage.goto(historyURL, {
      waitUntil: "domcontentloaded",
      timeout: HISTORY_TIMEOUT_MS,
    });
    await waitForHistoryPageToSettle(historyPage);
    const html = await historyPage.content();
    const summary = extractHistoryPageSummary(html);
    await writeFile(path.join(artifactRoot, "8xbet-history.html"), redactText(html, 200_000), "utf8");
    await historyPage.screenshot({ path: path.join(artifactRoot, "8xbet-history.png"), fullPage: false });
    return {
      bookmaker: "8xbet",
      browserLogin: "ok",
      historyPage: response?.status() === 200 && historyPage.url().includes(EIGHTXBET_HISTORY_PATH) ? "loaded" : "failed",
      historyNavigation: observations.length > 0 ? "observed" : "not_observed",
      httpStatus: response?.status(),
      pageURL: redactURL(historyPage.url()),
      summary,
      bodyPreview: redactText(await historyPage.locator("body").innerText().catch(() => "")),
    };
  } catch (error) {
    await loginPage.screenshot({ path: path.join(artifactRoot, "8xbet-error.png"), fullPage: false }).catch(() => undefined);
    return {
      bookmaker: "8xbet",
      browserLogin: loginPage.url().toLowerCase().includes("login") ? "failed" : "ok",
      historyPage: "failed",
      historyNavigation: "not_observed",
      error: errorMessage(error),
    };
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

async function checkJun88(): Promise<Jun88Result> {
  const lobby = JUN88_LOBBIES.find((item) => item.lobbyId === "cmd");
  if (!lobby) {
    return {
      bookmaker: "jun88",
      browserLogin: "failed",
      historyPage: "failed",
      historyLinkClicked: false,
      error: "CMD lobby is not configured",
    };
  }

  try {
    return await withJun88BookmakerPage(lobby, resolveJun88CmdPageURL(), async (page) => {
      const historyHost = await clickJun88HistoryLink(page);
      const historyLinkClicked = historyHost !== null;
      const observations: RequestObservation[] = [];
      const navigationPage = historyHost ?? page;
      const historyFrame = await findFraMain(navigationPage);
      const target: Page | Frame = historyFrame ?? navigationPage;
      attachHistoryObservers(navigationPage, JUN88_HISTORY_PATH, observations);
      const historyURL = jun88HistoryURL();
      const response = await target.goto(historyURL, {
        waitUntil: "domcontentloaded",
        timeout: HISTORY_TIMEOUT_MS,
      });
      await waitForHistoryPageToSettle(page);
      const html = await collectPageHTML(navigationPage);
      const summary = extractHistoryPageSummary(html);
      await writeFile(path.join(artifactRoot, "jun88-history.html"), redactText(html, 200_000), "utf8");
      await navigationPage.screenshot({ path: path.join(artifactRoot, "jun88-history.png"), fullPage: false });
      return {
        bookmaker: "jun88" as const,
        browserLogin: "ok" as const,
        historyPage: summary.sessionTimeout
          ? "session_timeout" as const
          : response?.status() === 200 && target.url().includes(JUN88_HISTORY_PATH)
            ? "loaded" as const
            : "failed" as const,
        historyLinkClicked,
        httpStatus: response?.status(),
        pageURL: redactURL(target.url()),
        summary,
        error: historyLinkClicked
          ? observations.length === 0 ? "history page response was not observed" : undefined
          : "CMD history button was not found; target page was opened directly",
      };
    });
  } catch (error) {
    return {
      bookmaker: "jun88",
      browserLogin: "failed",
      historyPage: "failed",
      historyLinkClicked: false,
      error: errorMessage(error),
    };
  }
}

async function clickJun88HistoryLink(page: Page): Promise<Page | null> {
  const pages = [page];
  const opener = await page.opener().catch(() => null);
  if (opener) pages.push(opener);
  for (const host of pages) {
    for (const frame of host.frames()) {
      const link = frame.locator(
        `a[href*="${JUN88_HISTORY_LINK_PATH}" i], [onclick*="${JUN88_HISTORY_LINK_PATH}" i]`,
      ).first();
      const candidate = await link.count().catch(() => 0) > 0
        ? link
        : frame.getByText("danh sách đã cược", { exact: false }).first();
      if (await candidate.count().catch(() => 0) > 0) {
        await candidate.click({ timeout: 5_000, noWaitAfter: true, force: true }).catch(() => undefined);
        await host.waitForTimeout(500);
        return host;
      }
    }
  }
  return null;
}

async function waitForHistoryPageToSettle(page: Page) {
  const deadline = Date.now() + Math.max(Number(envString("HISTORY_SETTLE_MS", "5000")), 1_000);
  while (Date.now() < deadline) {
    const bodyText = await page.locator("body").innerText().catch(() => "");
    const skeletonCount = await page.locator(".animate-pulse").count().catch(() => 0);
    if (bodyText.trim() !== "" && skeletonCount === 0) return;
    await page.waitForTimeout(250);
  }
}

async function findFraMain(page: Page) {
  return page.frames().find((frame) => frame.name().toLowerCase() === "framain") ?? null;
}

async function collectPageHTML(page: Page) {
  const parts = await Promise.all(page.frames().map((frame) => frame.content().catch(() => "")));
  return parts.join("\n");
}

function attachHistoryObservers(page: Page, pathFragment: string, observations: RequestObservation[]) {
  page.on("request", (request) => {
    if (request.url().includes(pathFragment)) {
      observations.push({ method: request.method(), url: redactURL(request.url()) });
    }
  });
  page.on("response", (response) => {
    if (response.url().includes(pathFragment)) {
      observations.push({ method: `RESPONSE ${response.status()}`, url: redactURL(response.url()) });
    }
  });
}

function eightXBetHistoryURL() {
  const explicit = envString("EIGHTXBET_HISTORY_PAGE_URL", "").trim();
  if (explicit) return explicit;
  const origin = new URL(resolveEightXBetInplayPageURL()).origin;
  return `${origin}${EIGHTXBET_HISTORY_PATH}?menu=sport&bet=unsettled&tab=0`;
}

function jun88HistoryURL() {
  const explicit = envString("JUN88_HISTORY_PAGE_URL", "").trim();
  if (explicit) return explicit;
  const date = dateString(new Date()).replaceAll("-", "");
  return `https://ss159.6688867.com${JUN88_HISTORY_PATH}?MatchDate=${date}&week=true`;
}

function dateString(value: Date) {
  return [value.getFullYear(), value.getMonth() + 1, value.getDate()]
    .map((part) => String(part).padStart(2, "0"))
    .join("-");
}

function printReport(eightXBet: EightXBetResult, jun88: Jun88Result) {
  console.log("8xbet:");
  console.log(`  browser_login: ${eightXBet.browserLogin}`);
  console.log(`  history_page: ${eightXBet.historyPage}`);
  console.log(`  history_navigation: ${eightXBet.historyNavigation}`);
  console.log(`  http_status: ${eightXBet.httpStatus ?? "unknown"}`);
  console.log(`  page_url: ${eightXBet.pageURL ?? "unknown"}`);
  console.log(`  tickets_found: ${eightXBet.summary?.ticketIDs.length ?? 0}`);
  console.log(`  error: ${eightXBet.error ?? "none"}`);
  console.log("jun88:");
  console.log(`  browser_login: ${jun88.browserLogin}`);
  console.log(`  history_link_clicked: ${jun88.historyLinkClicked}`);
  console.log(`  history_page: ${jun88.historyPage}`);
  console.log(`  http_status: ${jun88.httpStatus ?? "unknown"}`);
  console.log(`  page_url: ${jun88.pageURL ?? "unknown"}`);
  console.log(`  rows_found: ${jun88.summary?.rowCount ?? 0}`);
  console.log(`  ticket_ids: ${(jun88.summary?.ticketIDs ?? []).map((id) => redactText(id, 80)).join(", ") || "none"}`);
  console.log(`  error: ${jun88.error ?? "none"}`);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

main().catch((error) => {
  console.error(`[history-check] fatal: ${errorMessage(error)}`);
  process.exitCode = 1;
});
