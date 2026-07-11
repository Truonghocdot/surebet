import { chromium, type BrowserContext, type Page } from "playwright";
import { collectorLaunchOptions } from "../core/browser.js";
import { formatError, writeContextDebugArtifacts } from "../core/debug.js";
import type { Jun88LobbyAccess } from "../contracts.js";

export async function withJun88BookmakerPage<T>(
  lobby: Jun88LobbyAccess,
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

    const page = await openLobby(context, lobby, targetURL);
    try {
      return await run(page);
    } catch (error) {
      await writeContextDebugArtifacts(context, `${lobby.lobbyId}-run-failed`);
      throw error;
    }
  } catch (error) {
    if (context) {
      await writeContextDebugArtifacts(context, `${lobby.lobbyId}-open-failed`);
    }

    throw new Error(`[${lobby.lobbyId}] open bookmaker page failed: ${formatError(error)}`);
  } finally {
    await browser.close();
  }
}

async function openLobby(
  context: BrowserContext,
  lobby: Jun88LobbyAccess,
  targetURL: string,
  attempt = 1
): Promise<Page> {
  const existingPages = context.pages().length;
  const landingPage = await context.newPage();

  try {
    await landingPage.goto(targetURL, { waitUntil: "domcontentloaded" });
    await waitForStablePage(landingPage);

    if (matchesExpectedOrigin(landingPage.url(), lobby.expectedOriginPatterns)) {
      return landingPage;
    }

    const betNowButton = landingPage
      .locator("div.btnBet")
      .filter({ hasText: "Cược ngay" })
      .first();
    await betNowButton.waitFor({ state: "visible", timeout: 20_000 });

    const popupPromise = context.waitForEvent("page", { timeout: 10_000 }).catch(() => null);
    await betNowButton.click();
    const popup = await popupPromise;

    let resultPage = landingPage;
    if (popup) {
      resultPage = popup;
    } else if (context.pages().length > existingPages) {
      resultPage = context.pages()[context.pages().length - 1];
    }

    await waitForStablePage(resultPage);

    if (isMaintenanceURL(resultPage.url())) {
      throw new Error(`Lobby ${lobby.lobbyId} is in maintenance mode: ${resultPage.url()}`);
    }

    if (matchesExpectedOrigin(resultPage.url(), lobby.expectedOriginPatterns)) {
      return resultPage;
    }

    if (isCmdIntermediateURL(lobby, resultPage.url())) {
      const resolved = await waitForDeferredLobbyTarget(context, lobby, 15_000);
      if (resolved) {
        return resolved;
      }
    }

    if (attempt >= 3) {
      throw new Error(
        `Lobby ${lobby.lobbyId} did not resolve expected origin. Final URL: ${resultPage.url()}`
      );
    }

    await resultPage.close().catch(() => undefined);
    if (landingPage !== resultPage) {
      await landingPage.close().catch(() => undefined);
    }
    await delay(1_000 * attempt);
    return openLobby(context, lobby, targetURL, attempt + 1);
  } catch (error) {
    await writeContextDebugArtifacts(context, `${lobby.lobbyId}-open-attempt-${attempt}`);
    throw error;
  }
}

async function waitForStablePage(page: Page) {
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
}

function matchesExpectedOrigin(url: string, patterns: string[] = []) {
  try {
    const origin = new URL(url).origin;
    return patterns.length === 0
      ? true
      : patterns.some((pattern) => origin.includes(pattern));
  } catch {
    return false;
  }
}

function isCmdIntermediateURL(lobby: Jun88LobbyAccess, url: string) {
  return (
    lobby.lobbyId === "cmd" &&
    url.includes("/opgam/") &&
    url.includes("provider=CMD")
  );
}

function isMaintenanceURL(url: string) {
  return /maintenance\.html/i.test(url);
}

async function waitForDeferredLobbyTarget(
  context: BrowserContext,
  lobby: Jun88LobbyAccess,
  timeoutMs: number
) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    for (const currentPage of context.pages()) {
      if (matchesExpectedOrigin(currentPage.url(), lobby.expectedOriginPatterns)) {
        return currentPage;
      }

      for (const frame of currentPage.frames()) {
        if (matchesExpectedOrigin(frame.url(), lobby.expectedOriginPatterns)) {
          return currentPage;
        }
      }
    }

    await delay(500);
  }

  return null;
}

async function delay(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
