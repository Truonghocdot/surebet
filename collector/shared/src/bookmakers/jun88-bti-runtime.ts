import path from "node:path";
import { chromium } from "playwright";
import type { CollectContext, CollectorRuntime } from "../contracts.js";
import { parseJun88BtiSnapshot } from "./parsers/jun88-bti-parser.js";

export class Jun88BtiRuntime implements CollectorRuntime {
  constructor(private readonly collectorId: string) {}

  async collect(context: CollectContext) {
    if (!context.session) {
      throw new Error(
        `Jun88 BTI runtime requires a shared session. Run "npm run bootstrap:jun88" first.`
      );
    }

    if (!context.session.accessibleLobbies.includes("bti")) {
      throw new Error(
        `Shared session does not include lobby BTI. Re-run "npm run bootstrap:jun88".`
      );
    }

    const browser = await chromium.launch({
      headless: true
    });

    try {
      const page = await browser.newPage({
        storageState: context.session.storageStatePath
      });
      await page.goto("https://www.jun888e.ren/vi-vn/sports-landing/bti", {
        waitUntil: "domcontentloaded"
      });
      await page.waitForURL(/442hattrick\.com/, { timeout: 20_000 });
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
      await page.waitForSelector(".master_fe_Event_match", { timeout: 20_000 });

      const html = await page.content();
      return parseJun88BtiSnapshot(html, page.url());
    } finally {
      await browser.close();
    }
  }
}

