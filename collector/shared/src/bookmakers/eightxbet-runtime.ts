import type { CollectContext, CollectorRuntime } from "../contracts.js";
import { collectorLaunchOptions } from "../core/browser.js";
import { writeDebugArtifacts } from "../core/debug.js";
import { parseEightXBetIncomingSnapshot } from "./parsers/eightxbet-incoming-parser.js";
import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import { loadEightXBetSessionStorage } from "../session/eightxbet-session-storage.js";

const EIGHTXBET_INCOMING_PATH = "/sportEvents/incoming/football?hour=6";
const EIGHTXBET_READY_SELECTOR = '[data-testid^="v4-sport-asia-simple-handicap-unit-"]';
const EIGHTXBET_INFINITE_SCROLL_BOTTOM = '[data-testid="v4-sport-simple-handicap-infinite-scroll-bottom"]';

chromium.use(stealth());

export class EightXBetRuntime implements CollectorRuntime {
  constructor(private readonly collectorId: string) {}

  async collect(context: CollectContext) {
    if (!context.session) {
      throw new Error(
        `8xbet runtime requires a prepared session. Run "npm run bootstrap:8xbet" first.`
      );
    }

    const browser = await chromium.launch(collectorLaunchOptions(true));

    try {
      const contextPage = await browser.newContext({
        storageState: context.session.storageStatePath,
        locale: "vi-VN",
        timezoneId: "Asia/Ho_Chi_Minh",
        extraHTTPHeaders: {
          "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7"
        }
      });
      await contextPage.addInitScript(() => {
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
          window.sessionStorage.setItem("i18nextLng", "vi-VN");
          window.sessionStorage.setItem("language", "vi-VN");
          window.sessionStorage.setItem("lang", "vi-VN");
        } catch {}
      });
      const page = await contextPage.newPage();

      const targetURL = new URL(EIGHTXBET_INCOMING_PATH, context.setting.url).toString();
      if (context.session.sessionStoragePath) {
        const sessionValues = await loadEightXBetSessionStorage(context.session.sessionStoragePath).catch(
          () => null
        );
        if (sessionValues) {
          await page.goto(context.setting.url, { waitUntil: "domcontentloaded" });
          await page.evaluate((entries) => {
            for (const [key, value] of Object.entries(entries)) {
              window.sessionStorage.setItem(key, value);
            }
          }, sessionValues);
        }
      }

      await page.goto(targetURL, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
      await page.waitForSelector(EIGHTXBET_READY_SELECTOR, { timeout: 20_000 });
      await autoScrollIncomingList(page);
      await stabilizeIncomingList(page);

      const html = await page.content();
      return parseEightXBetIncomingSnapshot(html, page.url(), this.collectorId);
    } catch (error) {
      throw error;
    } finally {
      await browser.close();
    }
  }
}

async function autoScrollIncomingList(page: import("playwright").Page) {
  const bottom = page.locator(EIGHTXBET_INFINITE_SCROLL_BOTTOM).first();

  for (let index = 0; index < 12; index += 1) {
    await bottom.scrollIntoViewIfNeeded().catch(() => undefined);
    await page.mouse.wheel(0, 900).catch(() => undefined);
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
    await page.waitForTimeout(1200);
  }
}

async function stabilizeIncomingList(page: import("playwright").Page) {
  let previousCount = -1;
  let stableRounds = 0;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const currentCount = await page.locator('[data-testid^="simple-handicap-layout-football-"]').count();
    if (currentCount === previousCount) {
      stableRounds += 1;
    } else {
      stableRounds = 0;
    }

    if (stableRounds >= 2) {
      return;
    }

    previousCount = currentCount;
    await page.mouse.wheel(0, 700).catch(() => undefined);
    await page.waitForLoadState("networkidle", { timeout: 4_000 }).catch(() => undefined);
    await page.waitForTimeout(1200);
  }
}
