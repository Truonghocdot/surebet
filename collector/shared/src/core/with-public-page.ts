import { chromium, type BrowserContext, type Page } from "playwright";
import { collectorLaunchOptions } from "./browser.js";
import { formatError, writeContextDebugArtifacts } from "./debug.js";

export async function withPublicPage<T>(
  label: string,
  targetURL: string,
  run: (page: Page) => Promise<T>
): Promise<T> {
  const browser = await chromium.launch(await collectorLaunchOptions(true));
  let context: BrowserContext | null = null;

  try {
    context = await browser.newContext({
      viewport: { width: 1400, height: 900 },
      locale: "vi-VN",
      timezoneId: "Asia/Ho_Chi_Minh",
      extraHTTPHeaders: {
        "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7"
      }
    });

    const page = await context.newPage();
    await page.goto(targetURL, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(
      () => undefined
    );

    try {
      return await run(page);
    } catch (error) {
      await writeContextDebugArtifacts(context, `${label}-public-page-run-failed`);
      throw error;
    }
  } catch (error) {
    if (context) {
      await writeContextDebugArtifacts(context, `${label}-public-page-open-failed`);
    }

    throw new Error(`[${label}] open public page failed: ${formatError(error)}`);
  } finally {
    await browser.close();
  }
}
