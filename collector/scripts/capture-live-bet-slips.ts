import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Locator, Page } from "playwright";
import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import {
  JUN88_LOBBIES,
  collectorLaunchOptions,
  dismissEightXBetPostLoginOverlays,
  ensureEightXBetLogin,
  envString,
  installCollectorResourceBlocking,
  resolveJun88CmdPageURL,
} from "@surebet/collector-shared";
import { withJun88BookmakerPage } from "../shared/src/bookmakers/jun88-bookmaker-page.js";

const EIGHTXBET_CAPTURE_URL =
  "https://8x2000.com/sportEvents/inplay/football/match/4928833?tab=all&simpleGameCategory=inplay&type=market";
const JUN88_ODDS_SELECTOR = 'a.odds[href*="OddsClick"]';
const CAPTURE_TIMEOUT_MS = 30_000;

chromium.use(stealth());

void main();

async function main() {
  const docsRoot = path.resolve(process.cwd(), "../docs/lobbby");
  const debugRoot = path.resolve(process.cwd(), "tmp/collector/betslip-capture");
  const captureTarget = envString("BETSLIP_CAPTURE_BOOKMAKER", "all").trim().toLowerCase();
  if (!["all", "jun88", "8xbet"].includes(captureTarget)) {
    throw new Error(`unsupported BETSLIP_CAPTURE_BOOKMAKER=${captureTarget}`);
  }
  await mkdir(path.join(docsRoot, "jun888"), { recursive: true });
  await mkdir(path.join(docsRoot, "8xbet"), { recursive: true });
  await mkdir(debugRoot, { recursive: true });

  const failures: string[] = [];
  if (captureTarget === "all" || captureTarget === "jun88") {
    await captureJun88(docsRoot, debugRoot).catch((error) => {
      const message = asError(error).message;
      failures.push(`jun88: ${message}`);
      console.error(`[betslip-capture] Jun88 failed: ${message}`);
    });
  }
  if (captureTarget === "all" || captureTarget === "8xbet") {
    await captureEightXBet(docsRoot, debugRoot).catch((error) => {
      const message = asError(error).message;
      failures.push(`8xbet: ${message}`);
      console.error(`[betslip-capture] 8xbet failed: ${message}`);
    });
  }

  if (failures.length > 0) {
    throw new Error(`betslip capture incomplete: ${failures.join("; ")}`);
  }
}

async function captureJun88(docsRoot: string, debugRoot: string) {
  const lobby = JUN88_LOBBIES.find((item) => item.lobbyId === "cmd");
  if (!lobby) {
    throw new Error("Jun88 CMD lobby configuration is missing");
  }

  await withJun88BookmakerPage(lobby, resolveJun88CmdPageURL(), async (page) => {
    const selectedDetails = await clickJun88Odds(page, CAPTURE_TIMEOUT_MS);

    const sidebar = await waitForJun88Sidebar(page, 10_000);
    const html = await sanitizedOuterHTML(sidebar.locator, ["#tx_ran_code"]);
    const metadata = {
      capturedAt: new Date().toISOString(),
      pageUrl: page.url(),
      sidebarFrameUrl: sidebar.frame.url(),
      selected: selectedDetails,
      slip: {
        team: await textOf(sidebar.frame.locator("#lb_bet_team")),
        displayedOdds: await textOf(sidebar.frame.locator("#lb_bet_odds")),
        canonicalOdds: await valueOf(sidebar.frame.locator("#tx_bet_odds")),
        oddsType: await valueOf(sidebar.frame.locator("#tx_bet_oddsType")),
        minimumStake: await valueOf(sidebar.frame.locator("#tx_min_bet")),
        maximumStake: await valueOf(sidebar.frame.locator("#tx_max_bet")),
        stakeValueAfterSelection: await valueOf(sidebar.frame.locator("#tx_stake")),
        estimatedPayout: await textOf(sidebar.frame.locator("#lb_estPayVal")),
        stakeInputVisible: await sidebar.frame.locator("#tx_stake").isVisible(),
        submitVisible: await sidebar.frame.locator("#btnBet").isVisible(),
      },
    };

    await writeFile(
      path.join(docsRoot, "jun888/cmd-betslip-live.html"),
      `${html}\n`,
      "utf8",
    );
    await writeFile(
      path.join(docsRoot, "jun888/cmd-betslip-live.json"),
      `${JSON.stringify(metadata, null, 2)}\n`,
      "utf8",
    );
    await page.screenshot({
      path: path.join(debugRoot, "jun88-cmd-betslip.png"),
      fullPage: false,
    });
    console.log("[betslip-capture] saved Jun88 CMD sidebar; no bet was submitted");
  });
}

async function captureEightXBet(docsRoot: string, debugRoot: string) {
  const browser = await chromium.launch(await collectorLaunchOptions(true));
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    locale: "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
    extraHTTPHeaders: {
      "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
    },
  });

  try {
    await installCollectorResourceBlocking(context);
    const page = await context.newPage();
    await ensureEightXBetLogin(page);
    const targetUrl = envString("EIGHTXBET_BETSLIP_CAPTURE_URL", EIGHTXBET_CAPTURE_URL);
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: CAPTURE_TIMEOUT_MS });
    await dismissEightXBetPostLoginOverlays(page, 2_000);
    const matchId = matchIdFromURL(targetUrl);
    const selected = await waitForEightXBetOdds(page, matchId, CAPTURE_TIMEOUT_MS);
    const selectedDetails = {
      testId: await selected.getAttribute("data-testid"),
      text: (await selected.innerText()).trim(),
    };
    console.log(
      `[betslip-capture] 8xbet selecting odds test_id=${selectedDetails.testId}`,
    );
    await selected.click({ timeout: 10_000 });

    const card = page.getByTestId("sport-cart-single-card").first();
    await card.waitFor({ state: "visible", timeout: 10_000 });
    const cart = card.locator('xpath=ancestor::*[@data-testid="SportCart"][1]');
    const captureRoot = (await cart.count()) > 0 ? cart : card;
    const html = await sanitizedOuterHTML(captureRoot, []);
    const betButton = page.getByTestId("sport-cart-bet-button").first();
    const metadata = {
      capturedAt: new Date().toISOString(),
      pageUrl: page.url(),
      selected: selectedDetails,
      slip: {
        cardText: (await card.innerText()).trim(),
        inputVisible: await page.getByTestId("SportCartBetInput").first().isVisible(),
        currency: await textOf(page.getByTestId("sport-cart-currency-label").first()),
        amount: await textOf(page.getByTestId("sport-cart-bet-amount-label").first()),
        submitText: await textOf(betButton),
        submitDisabled: await betButton.isDisabled(),
      },
    };

    await writeFile(
      path.join(docsRoot, "8xbet/match-betslip-live.html"),
      `${html}\n`,
      "utf8",
    );
    await writeFile(
      path.join(docsRoot, "8xbet/match-betslip-live.json"),
      `${JSON.stringify(metadata, null, 2)}\n`,
      "utf8",
    );
    await page.screenshot({
      path: path.join(debugRoot, "8xbet-match-betslip.png"),
      fullPage: false,
    });
    console.log("[betslip-capture] saved 8xbet sidebar; no stake was entered and no bet was submitted");
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

async function clickJun88Odds(page: Page, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      if (frame.isDetached()) {
        continue;
      }
      const odds = frame.locator(JUN88_ODDS_SELECTOR);
      const count = await odds.count().catch(() => 0);
      for (let index = 0; index < count; index += 1) {
        const locator = odds.nth(index);
        const text = (await locator.textContent().catch(() => ""))?.trim() ?? "";
        if (!(await locator.isVisible().catch(() => false)) || !/^[-+]?\d+(?:\.\d+)?$/.test(text)) {
          continue;
        }
        const details = {
          frameUrl: frame.url(),
          href: await locator.getAttribute("href").catch(() => null),
          text,
        };
        console.log(
          `[betslip-capture] Jun88 selecting odds text=${JSON.stringify(details.text)}`,
        );
        const clicked = await locator
          .click({ timeout: 3_000 })
          .then(() => true)
          .catch(() => false);
        if (clicked) {
          return details;
        }
      }
    }
    await page.waitForTimeout(200);
  }
  throw new Error("Jun88 CMD did not expose a clickable odds link");
}

async function waitForJun88Sidebar(page: Page, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      const locator = frame.locator(".PlaceBetLeft").first();
      if (
        await locator.isVisible().catch(() => false) &&
        await frame.locator("#tx_stake").isVisible().catch(() => false)
      ) {
        return { frame, locator };
      }
    }
    await page.waitForTimeout(100);
  }
  throw new Error("Jun88 CMD bet sidebar did not appear after selecting odds");
}

async function waitForEightXBetOdds(page: Page, matchId: string, timeoutMs: number) {
  const selector = `button[data-testid^="oddsBtn-"][data-testid*="|${matchId}|"]`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const odds = page.locator(selector);
    for (let index = 0; index < await odds.count(); index += 1) {
      const locator = odds.nth(index);
      if (
        await locator.isVisible().catch(() => false) &&
        await locator.isEnabled().catch(() => false)
      ) {
        return locator;
      }
    }
    await page.waitForTimeout(200);
  }
  throw new Error(`8xbet match ${matchId} did not expose a clickable odds button`);
}

async function sanitizedOuterHTML(locator: Locator, redactedSelectors: string[]) {
  return locator.evaluate((element, selectors) => {
    const clone = element.cloneNode(true) as HTMLElement;
    for (const selector of selectors) {
      for (const input of clone.querySelectorAll<HTMLInputElement>(selector)) {
        input.value = "[redacted]";
        input.setAttribute("value", "[redacted]");
      }
    }
    return clone.outerHTML;
  }, redactedSelectors);
}

async function textOf(locator: Locator) {
  return (await locator.textContent().catch(() => null))?.trim() ?? null;
}

async function valueOf(locator: Locator) {
  return locator.inputValue().catch(() => null);
}

function matchIdFromURL(url: string) {
  const match = new URL(url).pathname.match(/\/match\/(\d+)/);
  if (!match) {
    throw new Error(`8xbet capture URL has no match id: ${url}`);
  }
  return match[1];
}

function asError(value: unknown) {
  return value instanceof Error ? value : new Error(String(value));
}
