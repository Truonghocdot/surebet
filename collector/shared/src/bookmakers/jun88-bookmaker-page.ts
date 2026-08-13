import { chromium, type BrowserContext, type Locator, type Page } from "playwright";
import { collectorLaunchOptions } from "../core/browser.js";
import { formatError, writeContextDebugArtifacts } from "../core/debug.js";
import { envBool, envInt, envString } from "../core/env.js";
import { installCollectorResourceBlocking } from "../core/resource-blocking.js";
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
    await installCollectorResourceBlocking(context);
    await ensureJun88Login(context, lobby);

    const page = await openLobby(context, lobby, targetURL);
    try {
      return await run(page);
    } catch (error) {
      await writeContextDebugArtifacts(context, `${lobby.lobbyId}-run-failed`);
      throw error;
    }
  } catch (error) {
    if (context) {
      for (const currentPage of context.pages()) {
        await currentPage.locator('input[type="password"]').fill("").catch(() => undefined);
      }
      await writeContextDebugArtifacts(context, `${lobby.lobbyId}-open-failed`);
    }

    throw new Error(`[${lobby.lobbyId}] open bookmaker page failed: ${formatError(error)}`);
  } finally {
    await browser.close();
  }
}

async function ensureJun88Login(context: BrowserContext, lobby: Jun88LobbyAccess) {
  if (!envBool("JUN88_LOGIN_ENABLED", false)) {
    return;
  }

  const username = envString("JUN88_LOGIN_USERNAME", "").trim();
  const password = envString("JUN88_LOGIN_PASSWORD", "").trim();
  if (!username || !password) {
    throw new Error(
      "JUN88_LOGIN_ENABLED=true requires JUN88_LOGIN_USERNAME and JUN88_LOGIN_PASSWORD"
    );
  }

  const loginURL = envString(
    "JUN88_LOGIN_URL",
    lobby.loginURL || "https://www.jun88b5.net/vi-vn/home"
  ).trim();
  const page = await context.newPage();
  const timeoutMs = Math.max(envInt("COLLECTOR_LOGIN_TIMEOUT_MS", 20_000), 5_000);

  try {
    await page.goto(loginURL, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await waitForStablePage(page);
    await page.waitForTimeout(
      Math.min(Math.max(envInt("COLLECTOR_LOGIN_SETTLE_MS", 1_000), 250), 5_000)
    );

    const passwordField = await firstVisibleLocator(
      page.locator('input[type="password"]')
    );
    if (!passwordField) {
      const entryButton = await firstVisibleLocator(
        page.getByRole("button", { name: /đăng nhập|login/i })
      );
      if (!entryButton) {
        throw new Error("Jun88 login button was not found on the home page");
      }
      await entryButton.click();
    }

    const resolvedPasswordField =
      passwordField ||
      (await firstVisibleLocator(page.locator('input[type="password"]')));
    if (!resolvedPasswordField) {
      throw new Error("Jun88 password field was not rendered after opening login form");
    }

    const usernameField = await firstVisibleLocator(
      page.locator(
        'form input[autocomplete="username"], form input[name*="user" i], form input[name*="account" i], form input[type="text"], form input[type="tel"]'
      )
    ) || await firstVisibleLocator(
      page.locator(
        'input[autocomplete="username"], input[name*="user" i], input[name*="account" i], input[type="text"], input[type="tel"]'
      )
    );
    if (!usernameField) {
      throw new Error("Jun88 username field was not rendered after opening login form");
    }

    await usernameField.fill(username);
    await resolvedPasswordField.fill(password);

    const submitButton = await firstVisibleLocator(
      page.getByRole("button", { name: /đăng nhập|login/i }).last()
    );
    if (!submitButton) {
      throw new Error("Jun88 login submit button was not found");
    }
    await submitButton.click();
    await waitForLoginFormToClose(page, resolvedPasswordField, timeoutMs);

    const formStillVisible = await resolvedPasswordField.isVisible().catch(() => false);
    if (formStillVisible) {
      const errorText = await readLoginError(page);
      throw new Error(`Jun88 login did not complete${errorText ? `: ${errorText}` : ""}`);
    }

    console.log(`[jun88-auth] login succeeded path=${safePathname(page.url())}`);
  } finally {
    await page.close().catch(() => undefined);
  }
}

async function waitForLoginFormToClose(
  page: Page,
  passwordField: Locator,
  timeoutMs: number
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await passwordField.isVisible().catch(() => false))) {
      return;
    }
    await page.waitForTimeout(200);
  }
}

async function firstVisibleLocator(locator: Locator): Promise<Locator | null> {
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible().catch(() => false)) {
      return candidate;
    }
  }
  return null;
}

async function readLoginError(page: Page) {
  const errorLocator = page.locator('[role="alert"], .error, .err, .text-danger');
  const texts = await errorLocator.allTextContents().catch(() => []);
  return texts.map((text) => text.trim()).filter(Boolean).slice(0, 1).join(" ").slice(0, 240);
}

function safePathname(url: string) {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
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
  await page.waitForTimeout(Math.max(envInt("COLLECT_PAGE_SETTLE_MS", 1_000), 0));
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
