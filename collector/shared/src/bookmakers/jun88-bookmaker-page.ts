import { chromium, type BrowserContext, type Locator, type Page } from "playwright";
import { collectorLaunchOptions } from "../core/browser.js";
import { formatError, writeContextDebugArtifacts } from "../core/debug.js";
import { envBool, envInt, envString } from "../core/env.js";
import { installCollectorResourceBlocking } from "../core/resource-blocking.js";
import { resolveJun88LoginURL } from "../core/page-url-resolver.js";
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
    const authenticatedPage = await ensureJun88Login(context);

    const page = await openLobby(context, lobby, targetURL, authenticatedPage);
    // Login and lobby bootstrap need the bookmaker's styles/scripts. Apply the
    // lightweight resource policy only after the authenticated page is ready.
    await installCollectorResourceBlocking(context);
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

async function ensureJun88Login(
  context: BrowserContext
): Promise<Page | undefined> {
  const username = envString("JUN88_LOGIN_USERNAME", "").trim();
  const password = envString("JUN88_LOGIN_PASSWORD", "").trim();
  const loginEnabled = envBool("JUN88_LOGIN_ENABLED", Boolean(username && password));
  if (!loginEnabled) {
    return undefined;
  }
  if (!username || !password) {
    throw new Error(
      "JUN88_LOGIN_ENABLED=true requires JUN88_LOGIN_USERNAME and JUN88_LOGIN_PASSWORD"
    );
  }

  const loginURL = resolveJun88LoginURL();
  const page = await context.newPage();
  const timeoutMs = Math.max(envInt("COLLECTOR_LOGIN_TIMEOUT_MS", 20_000), 5_000);
  const settleMs = Math.min(
    Math.max(envInt("COLLECTOR_LOGIN_SETTLE_MS", 1_000), 250),
    5_000
  );

  try {
    console.log(`[jun88-auth] opening direct login url=${loginURL}`);
    await page.goto(loginURL, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await waitForStablePage(page);
    await page.waitForTimeout(settleMs);

    const loginFormStartedAt = Date.now();
    const resolvedPasswordField = await waitForJun88DirectLoginForm(page, timeoutMs);
    const usernameField = await waitForVisibleLocator(
      page,
      () => findJun88UsernameField(page, resolvedPasswordField),
      timeoutMs,
      "Jun88 username field was not rendered"
    );
    console.log(
      `[jun88-auth] login form ready elapsed_ms=${Date.now() - loginFormStartedAt} path=${safePathname(page.url())}`
    );

    await usernameField.fill(username);
    await resolvedPasswordField.fill(password);

    const submitButton = await waitForVisibleLocator(
      page,
      () => findJun88LoginSubmitButton(resolvedPasswordField),
      timeoutMs,
      "Jun88 login submit button was not rendered"
    );
    if (!(await dismissJun88Announcement(page, timeoutMs))) {
      throw new Error("Jun88 announcement remained visible before login submission");
    }
    await submitButton.click({ timeout: timeoutMs });
    await waitForLoginFormToClose(page, resolvedPasswordField, timeoutMs);

    const formStillVisible = await resolvedPasswordField.isVisible().catch(() => false);
    if (formStillVisible) {
      const errorText = await readLoginError(page);
      throw new Error(`Jun88 login did not complete${errorText ? `: ${errorText}` : ""}`);
    }

    await page.waitForTimeout(settleMs);
    console.log(`[jun88-auth] login succeeded path=${safePathname(page.url())}`);
    return page;
  } catch (error) {
    await page.close().catch(() => undefined);
    throw error;
  }
}

export async function waitForJun88DirectLoginForm(
  page: Page,
  timeoutMs: number
): Promise<Locator> {
  return waitForVisibleLocator(
    page,
    () => firstVisibleLocator(page.locator('input[type="password"]')),
    timeoutMs,
    "Jun88 direct login form was not rendered"
  );
}

export async function waitForJun88LoginForm(
  page: Page,
  timeoutMs: number
): Promise<Locator> {
  const surface = await waitForJun88LoginSurface(page, timeoutMs);
  if (surface.passwordField) {
    return surface.passwordField;
  }

  if (!(await dismissJun88Announcement(page, timeoutMs))) {
    throw new Error("Jun88 announcement remained visible before opening the login form");
  }
  await surface.entryButton.click({ timeout: timeoutMs });
  return waitForVisibleLocator(
    page,
    () => firstVisibleLocator(page.locator('input[type="password"]')),
    timeoutMs,
    "Jun88 password field was not rendered after opening the login form"
  );
}

type Jun88LoginSurface =
  | { passwordField: Locator; entryButton?: never }
  | { passwordField?: never; entryButton: Locator };

async function waitForJun88LoginSurface(
  page: Page,
  timeoutMs: number
): Promise<Jun88LoginSurface> {
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;

  while (Date.now() <= deadline) {
    const announcementCleared = await dismissJun88Announcement(page, timeoutMs);
    if (!announcementCleared) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        break;
      }
      await page.waitForTimeout(Math.min(200, remainingMs));
      continue;
    }

    const passwordField = await firstVisibleLocator(page.locator('input[type="password"]'));
    if (passwordField) {
      return { passwordField };
    }

    const entryButton = await findJun88EntryButton(page);
    if (entryButton) {
      return { entryButton };
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      break;
    }
    await page.waitForTimeout(Math.min(200, remainingMs));
  }

  throw new Error(
    `Jun88 login button or form was not rendered after waiting ${Date.now() - startedAt}ms (${await describePage(page)})`
  );
}

async function findJun88EntryButton(page: Page) {
  const candidates = page.getByRole("button", {
    name: /^\s*(đăng nhập|login)\s*$/i
  });
  const count = await candidates.count();
  for (let index = 0; index < count; index += 1) {
    const candidate = candidates.nth(index);
    if (!(await candidate.isVisible().catch(() => false))) {
      continue;
    }
    if ((await candidate.locator("xpath=ancestor::form").count()) === 0) {
      return candidate;
    }
  }

  return firstVisibleLocator(
    page
      .locator('button[class*="btnLogin"], button[data-testid*="login" i]')
      .filter({ hasText: /^\s*(đăng nhập|login)\s*$/i })
  );
}

async function findJun88UsernameField(page: Page, passwordField: Locator) {
  const selector =
    'input[autocomplete="username"], input[name*="user" i], input[name*="account" i], input[type="text"], input[type="tel"]';
  const form = passwordField.locator("xpath=ancestor::form[1]");
  if ((await form.count()) > 0) {
    const inForm = await firstVisibleLocator(form.locator(selector));
    if (inForm) {
      return inForm;
    }
  }
  return firstVisibleLocator(page.locator(selector));
}

export async function findJun88LoginSubmitButton(passwordField: Locator) {
  const form = passwordField.locator("xpath=ancestor::form[1]");
  if ((await form.count()) > 0) {
    const typedSubmit = await firstVisibleLocator(
      form.locator('button[type="submit"], input[type="submit"]')
    );
    if (typedSubmit) {
      return typedSubmit;
    }

    const inForm = await firstVisibleLocator(
      form.getByRole("button", { name: /đăng\s*nhập|login/i })
    );
    if (inForm) {
      return inForm;
    }
  }

  const modal = passwordField.locator(
    'xpath=ancestor::*[@role="dialog" or contains(@class, "ReactModal__Content")][1]'
  );
  if ((await modal.count()) > 0) {
    return firstVisibleLocator(
      modal.locator('button[type="submit"], input[type="submit"], button').filter({
        hasText: /đăng\s*nhập|login/i
      })
    );
  }

  return null;
}

async function dismissJun88Announcement(page: Page, timeoutMs: number) {
  const deadline = Date.now() + Math.min(Math.max(timeoutMs, 250), 3_000);
  let dismissed = 0;
  const methods = new Set<string>();

  while (Date.now() < deadline) {
    const closeButton = await firstVisibleLocator(
      page.locator(".multi-announcement-close")
    );
    if (!closeButton) {
      if (dismissed > 0) {
        console.log(
          `[jun88-auth] announcement dismissed count=${dismissed} methods=${[...methods].join(",")}`
        );
      }
      return true;
    }

    const normalClick = await closeButton
      .click({ timeout: Math.min(Math.max(deadline - Date.now(), 100), 500) })
      .then(() => true)
      .catch(() => false);
    if (await waitForJun88AnnouncementToClear(page, 250)) {
      methods.add("locator");
      dismissed += 1;
      continue;
    }

    const forcedClick = await closeButton
      .click({ force: true, timeout: Math.min(Math.max(deadline - Date.now(), 100), 300) })
      .then(() => true)
      .catch(() => false);
    if (await waitForJun88AnnouncementToClear(page, 250)) {
      methods.add("force");
      dismissed += 1;
      continue;
    }

    const domClick = await page.evaluate(() => {
      const candidates = document.querySelectorAll<HTMLElement>(
        ".multi-announcement-close"
      );
      for (const candidate of candidates) {
        const style = window.getComputedStyle(candidate);
        const rect = candidate.getBoundingClientRect();
        if (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          rect.width > 0 &&
          rect.height > 0
        ) {
          candidate.click();
          return true;
        }
      }
      return false;
    }).catch(() => false);
    if (await waitForJun88AnnouncementToClear(page, Math.min(deadline - Date.now(), 750))) {
      methods.add("dom");
      dismissed += 1;
      continue;
    }

    console.warn(
      `[jun88-auth] announcement close did not clear overlay ` +
      `normal_click=${normalClick} force_click=${forcedClick} dom_click=${domClick}`
    );
    return false;
  }

  return !(await hasVisibleJun88Announcement(page));
}

async function waitForJun88AnnouncementToClear(page: Page, timeoutMs: number) {
  const deadline = Date.now() + Math.max(timeoutMs, 0);
  do {
    if (!(await hasVisibleJun88Announcement(page))) {
      return true;
    }
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      return false;
    }
    await page.waitForTimeout(Math.min(50, remainingMs));
  } while (Date.now() <= deadline);
  return false;
}

async function hasVisibleJun88Announcement(page: Page) {
  return (await firstVisibleLocator(page.locator(".multi-announcement-close"))) !== null;
}

async function waitForVisibleLocator(
  page: Page,
  resolveLocator: () => Promise<Locator | null>,
  timeoutMs: number,
  errorMessage: string
): Promise<Locator> {
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;

  while (Date.now() <= deadline) {
    const locator = await resolveLocator();
    if (locator) {
      return locator;
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      break;
    }
    await page.waitForTimeout(Math.min(200, remainingMs));
  }

  throw new Error(
    `${errorMessage} after waiting ${Date.now() - startedAt}ms (${await describePage(page)})`
  );
}

async function describePage(page: Page) {
  const state = await page.evaluate(() => ({
    readyState: document.readyState,
    title: document.title.slice(0, 120)
  })).catch(() => ({ readyState: "unavailable", title: "" }));
  return `url=${page.url()} ready_state=${state.readyState} title=${JSON.stringify(state.title)}`;
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
  authenticatedPage?: Page,
  attempt = 1
): Promise<Page> {
  const existingPages = context.pages().length;
  const landingPage = authenticatedPage && !authenticatedPage.isClosed()
    ? authenticatedPage
    : await context.newPage();

  try {
    console.log(`[jun88-auth] opening CMD lobby in authenticated tab target=${targetURL}`);
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

    if (landingPage !== resultPage) {
      await resultPage.close().catch(() => undefined);
    }
    await delay(1_000 * attempt);
    return openLobby(context, lobby, targetURL, landingPage, attempt + 1);
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
