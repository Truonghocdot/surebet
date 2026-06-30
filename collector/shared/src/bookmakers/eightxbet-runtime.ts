import type { CollectContext, CollectorRuntime } from "../contracts.js";
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

    const browser = await chromium.launch({
      headless: true
    });

    try {
      const page = await browser.newPage({
        storageState: context.session.storageStatePath
      });

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

  for (let index = 0; index < 8; index += 1) {
    await bottom.scrollIntoViewIfNeeded().catch(() => undefined);
    await page.mouse.wheel(0, 1200).catch(() => undefined);
    await page.waitForLoadState("networkidle", { timeout: 4_000 }).catch(() => undefined);
    await page.waitForTimeout(800);
  }
}
