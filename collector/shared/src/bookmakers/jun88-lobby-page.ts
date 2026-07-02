import { chromium, type BrowserContext, type Page } from "playwright";
import { collectorLaunchOptions } from "../core/browser.js";
import type { Jun88LobbyAccess, SessionState } from "../contracts.js";
import { formatError, writeContextDebugArtifacts } from "../core/debug.js";

export async function withJun88LobbyPage<T>(
  session: SessionState,
  lobby: Jun88LobbyAccess,
  run: (page: Page) => Promise<T>
) {
  const browser = await chromium.launch(collectorLaunchOptions(true));

  try {
    const context = await browser.newContext({
      storageState: session.storageStatePath
    });
    await warmVisitedOrigins(context, session.visitedOrigins ?? []);
    const page = await openLobby(context, lobby);
    try {
      return await run(page);
    } catch (error) {
      await writeContextDebugArtifacts(context, `${lobby.lobbyId}-run-failed`);
      throw error;
    }
  } finally {
    await browser.close();
  }
}

async function warmVisitedOrigins(context: BrowserContext, origins: string[]) {
  for (const origin of origins) {
    const page = await context.newPage();
    try {
      await page.goto(origin, { waitUntil: "domcontentloaded", timeout: 10_000 }).catch(() => undefined);
      await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
    } finally {
      await page.close().catch(() => undefined);
    }
  }
}

async function openLobby(context: BrowserContext, lobby: Jun88LobbyAccess, attempt = 1): Promise<Page> {
  const existingPages = context.pages().length;
  const page = await context.newPage();
  try {
    await page.goto(lobby.launchURL, { waitUntil: "domcontentloaded" });
    await waitForStableLobbyPage(page);

    const betNowButton = page.locator("div.btnBet").filter({ hasText: "Cược ngay" }).first();
    await betNowButton.waitFor({ state: "visible", timeout: 20_000 });

    const popupPromise = context.waitForEvent("page", { timeout: 10_000 }).catch(() => null);
    await betNowButton.click();
    const popup = await popupPromise;

    let resultPage = page;
    if (popup) {
      resultPage = popup;
    } else if (context.pages().length > existingPages) {
      resultPage = context.pages()[context.pages().length - 1];
    }

    await waitForStableLobbyPage(resultPage);

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
    if (page !== resultPage) {
      await page.close().catch(() => undefined);
    }
    await delay(1_000 * attempt);
    return openLobby(context, lobby, attempt + 1);
  } catch (error) {
    await writeContextDebugArtifacts(context, `${lobby.lobbyId}-open-failed-attempt-${attempt}`);
    throw new Error(
      `[${lobby.lobbyId}] open lobby failed on attempt ${attempt}: ${formatError(error)}`
    );
  }
}

export async function openJun88ResolvedLobbyPage<T>(
  session: SessionState,
  lobby: Jun88LobbyAccess,
  run: (page: Page) => Promise<T>,
  fallbackURL?: string
): Promise<T> {
  const browser = await chromium.launch(collectorLaunchOptions(true));
  let context: BrowserContext | null = null;

  try {
    context = await browser.newContext({
      storageState: session.storageStatePath
    });
    await warmVisitedOrigins(context, session.visitedOrigins ?? []);

    const page = await context.newPage();
    const targetURL = session.lobbyURLs?.[lobby.lobbyId] || fallbackURL || lobby.launchURL;
    await page.goto(targetURL, { waitUntil: "domcontentloaded" });
    await waitForStableLobbyPage(page);

    if (isMaintenanceURL(page.url())) {
      throw new Error(`Lobby ${lobby.lobbyId} is in maintenance mode: ${page.url()}`);
    }

    try {
      return await run(page);
    } catch (error) {
      await writeContextDebugArtifacts(context, `${lobby.lobbyId}-resolved-run-failed`);
      throw error;
    }
  } catch (error) {
    if (context) {
      await writeContextDebugArtifacts(context, `${lobby.lobbyId}-resolved-open-failed`);
    }
    throw error;
  } finally {
    await browser.close();
  }
}

async function waitForStableLobbyPage(page: Page) {
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
