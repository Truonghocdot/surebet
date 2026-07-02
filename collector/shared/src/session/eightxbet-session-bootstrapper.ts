import { access } from "node:fs/promises";
import path from "node:path";
import type { Browser, BrowserContext, Page } from "playwright";
import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import type {
  BookmakerSetting,
  SessionBootstrapper,
  SessionState,
  SessionStateStore
} from "../contracts.js";
import { collectorLaunchOptions } from "../core/browser.js";
import { formatError, writeDebugArtifacts } from "../core/debug.js";
import {
  loadEightXBetLocalStorage,
  loadEightXBetSessionStorage,
  saveEightXBetLocalStorage,
  saveEightXBetSessionStorage
} from "./eightxbet-session-storage.js";

type EightXBetBootstrapOptions = {
  stateStore: SessionStateStore;
  storageStatePath?: string;
  sessionStoragePath?: string;
  localStoragePath?: string;
};

type EightXBetSessionPaths = {
  storageStatePath: string;
  sessionStoragePath: string;
  localStoragePath: string;
};

chromium.use(stealth());

export class EightXBetSessionBootstrapper implements SessionBootstrapper {
  constructor(private readonly options: EightXBetBootstrapOptions) {}

  async prepare(setting: BookmakerSetting): Promise<SessionState> {
    const existing = await this.options.stateStore.read("8xbet");
    if (existing && (await this.isUsableSession(existing))) {
      return existing;
    }

    if (existing) {
      console.warn("[8xbet-session] stored session is missing auth tokens, refreshing...");
      return this.refresh(setting);
    }

    console.warn("[8xbet-session] stored session is missing, bootstrapping headlessly...");
    return this.refresh(setting);
  }

  async refresh(setting: BookmakerSetting): Promise<SessionState> {
    const paths = this.resolvePaths();
    const browser = await chromium.launch(collectorLaunchOptions(true));
    let page: Page | null = null;

    try {
      const context = await this.newRefreshContext(browser, paths);
      page = await context.newPage();
      const sportEventsURL = new URL("/sportEvents", setting.url).toString();

      await page.goto(sportEventsURL, { waitUntil: "domcontentloaded" }).catch(() => undefined);
      await restoreEightXBetStorage(page, paths);
      await page.goto(sportEventsURL, { waitUntil: "domcontentloaded" }).catch(() => undefined);
      await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => undefined);

      if (!(await hasRequiredAuthTokens(page, 8_000))) {
        await page.goto(setting.url, { waitUntil: "domcontentloaded" });
        await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => undefined);
        const loginAttempted = await tryAutoLogin(page, setting.username, setting.password);
        if (!loginAttempted) {
          throw new Error("8xbet auto login form was not available.");
        }

        await waitForSportEvents(page, 15_000);
      }

      if (!(await hasRequiredAuthTokens(page, 12_000))) {
        throw new Error("8xbet login finished without access-token/refresh-token.");
      }

      return await persistEightXBetSession(context, page, this.options.stateStore, paths);
    } catch (error) {
      if (page) {
        await writeDebugArtifacts(page, "8xbet-session-refresh-failed");
      }
      throw new Error(
        [
          `8xbet session refresh failed: ${formatError(error)}`,
          'Run "npm run bootstrap:8xbet" if Cloudflare/challenge requires manual login.'
        ].join(" ")
      );
    } finally {
      await browser.close();
    }
  }

  private resolvePaths(): EightXBetSessionPaths {
    return {
      storageStatePath:
        this.options.storageStatePath ?? path.resolve("tmp/session/8xbet-storage-state.json"),
      sessionStoragePath:
        this.options.sessionStoragePath ?? path.resolve("tmp/session/8xbet-session-storage.json"),
      localStoragePath:
        this.options.localStoragePath ?? path.resolve("tmp/session/8xbet-local-storage.json")
    };
  }

  private async isUsableSession(session: SessionState): Promise<boolean> {
    try {
      await access(session.storageStatePath);
      if (session.sessionStoragePath) {
        await access(session.sessionStoragePath);
      }
      if (session.localStoragePath) {
        await access(session.localStoragePath);
      }

      const [sessionStorageValues, localStorageValues] = await Promise.all([
        session.sessionStoragePath
          ? loadEightXBetSessionStorage(session.sessionStoragePath).catch(() => ({}))
          : Promise.resolve({}),
        session.localStoragePath
          ? loadEightXBetLocalStorage(session.localStoragePath).catch(() => ({}))
          : Promise.resolve({})
      ]);

      return (
        hasStorageValue(sessionStorageValues, "access-token") ||
        hasStorageValue(localStorageValues, "access-token")
      ) && (
        hasStorageValue(sessionStorageValues, "refresh-token") ||
        hasStorageValue(localStorageValues, "refresh-token")
      );
    } catch {
      return false;
    }
  }

  private async newRefreshContext(browser: Browser, paths: EightXBetSessionPaths) {
    const contextOptions: {
      storageState?: string;
      viewport: { width: number; height: number };
      locale: string;
      timezoneId: string;
      extraHTTPHeaders: Record<string, string>;
    } = {
      viewport: { width: 1400, height: 900 },
      locale: "vi-VN",
      timezoneId: "Asia/Ho_Chi_Minh",
      extraHTTPHeaders: {
        "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7"
      }
    };

    await access(paths.storageStatePath)
      .then(() => {
        contextOptions.storageState = paths.storageStatePath;
      })
      .catch(() => undefined);

    const context = await browser.newContext(contextOptions);
    await context.addInitScript(() => {
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
    return context;
  }
}

function hasStorageValue(values: Record<string, string>, key: string) {
  return typeof values[key] === "string" && values[key] !== "";
}

type EightXBetStoragePayload = {
  sessionEntries: Record<string, string> | null;
  localEntries: Record<string, string> | null;
};

async function restoreEightXBetStorage(page: Page, paths: EightXBetSessionPaths) {
  const [sessionEntries, localEntries] = await Promise.all([
    loadEightXBetSessionStorage(paths.sessionStoragePath).catch(() => null),
    loadEightXBetLocalStorage(paths.localStoragePath).catch(() => null)
  ]);

  await page.evaluate(
    ({ sessionEntries, localEntries }: EightXBetStoragePayload) => {
      if (sessionEntries) {
        for (const [key, value] of Object.entries(sessionEntries)) {
          window.sessionStorage.setItem(key, value);
        }
      }
      if (localEntries) {
        for (const [key, value] of Object.entries(localEntries)) {
          window.localStorage.setItem(key, value);
        }
      }

      for (const key of ["access-token", "refresh-token"]) {
        const value = window.localStorage.getItem(key) || window.sessionStorage.getItem(key);
        if (value) {
          window.localStorage.setItem(key, value);
          window.sessionStorage.setItem(key, value);
        }
      }
    },
    { sessionEntries, localEntries }
  );
}

async function hasRequiredAuthTokens(page: Page, timeoutMs: number) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const state = await page
      .evaluate(() => {
        for (const key of ["access-token", "refresh-token"]) {
          const value = window.localStorage.getItem(key) || window.sessionStorage.getItem(key);
          if (value) {
            window.localStorage.setItem(key, value);
            window.sessionStorage.setItem(key, value);
          }
        }

        return {
          hasAccessToken:
            !!window.localStorage.getItem("access-token") ||
            !!window.sessionStorage.getItem("access-token"),
          hasRefreshToken:
            !!window.localStorage.getItem("refresh-token") ||
            !!window.sessionStorage.getItem("refresh-token")
        };
      })
      .catch(() => ({ hasAccessToken: false, hasRefreshToken: false }));

    if (state.hasAccessToken && state.hasRefreshToken) {
      return true;
    }

    await page.waitForTimeout(500);
  }

  return false;
}

async function waitForSportEvents(page: Page, timeoutMs: number) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (page.url().includes("/sportEvents")) {
      return true;
    }

    await page.waitForTimeout(500);
  }

  return false;
}

async function persistEightXBetSession(
  context: BrowserContext,
  page: Page,
  stateStore: SessionStateStore,
  paths: EightXBetSessionPaths
) {
  await context.storageState({ path: paths.storageStatePath }).catch(() => undefined);

  const [existingSessionStorageValues, existingLocalStorageValues] = await Promise.all([
    loadEightXBetSessionStorage(paths.sessionStoragePath).catch(() => ({})),
    loadEightXBetLocalStorage(paths.localStoragePath).catch(() => ({}))
  ]);

  const sessionStorageValues = await page
    .evaluate(() => {
      const output: Record<string, string> = {};
      for (let index = 0; index < window.sessionStorage.length; index += 1) {
        const key = window.sessionStorage.key(index);
        if (key) {
          output[key] = window.sessionStorage.getItem(key) ?? "";
        }
      }
      return output;
    })
    .catch(() => existingSessionStorageValues);

  const localStorageValues = await page
    .evaluate(() => {
      const output: Record<string, string> = {};
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index);
        if (key) {
          output[key] = window.localStorage.getItem(key) ?? "";
        }
      }
      return output;
    })
    .catch(() => existingLocalStorageValues);

  if (
    !(hasStorageValue(sessionStorageValues, "access-token") ||
      hasStorageValue(localStorageValues, "access-token")) ||
    !(hasStorageValue(sessionStorageValues, "refresh-token") ||
      hasStorageValue(localStorageValues, "refresh-token"))
  ) {
    throw new Error("8xbet refreshed session could not be persisted with auth tokens.");
  }

  await saveEightXBetSessionStorage(paths.sessionStoragePath, sessionStorageValues);
  await saveEightXBetLocalStorage(paths.localStoragePath, localStorageValues);

  const state: SessionState = {
    bookmakerCode: "8xbet",
    originURL: safePageURL(page),
    bootstrapMode: "headless",
    preparedAt: new Date().toISOString(),
    storageStatePath: paths.storageStatePath,
    sessionStoragePath: paths.sessionStoragePath,
    localStoragePath: paths.localStoragePath,
    accessibleLobbies: ["default"],
    visitedOrigins: safeVisitedOrigins(context)
  };

  await stateStore.write(state);
  return state;
}

function safePageURL(page: Page) {
  try {
    return page.url();
  } catch {
    return "about:blank";
  }
}

function safeVisitedOrigins(context: BrowserContext) {
  try {
    return Array.from(new Set(context.pages().map((currentPage) => currentPage.url())));
  } catch {
    return [];
  }
}

async function tryAutoLogin(page: Page, username: string, password: string) {
  try {
    const primaryLoginButton = page
      .locator('button[data-testid="submit-btn"][type="button"]')
      .first();

    await primaryLoginButton.waitFor({ state: "visible", timeout: 20_000 }).catch(() => undefined);
    if (!(await primaryLoginButton.isVisible().catch(() => false))) {
      return false;
    }

    await primaryLoginButton.click().catch(() => undefined);
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
    await page.waitForTimeout(2_000);

    const directAccountField = page.locator('[data-testid="login-field-account"]').first();
    const directPasswordField = page.locator('[data-testid="login-field-password"]').first();

    const directFormReady = await directAccountField
      .waitFor({ state: "visible", timeout: 8_000 })
      .then(async () => directPasswordField.isVisible().catch(() => false))
      .catch(() => false);

    if (!directFormReady) {
      const emailMethod = page.locator('[data-testid="login-email"]').first();
      if (await emailMethod.isVisible().catch(() => false)) {
        await emailMethod.click().catch(() => undefined);
        await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
        await page.waitForTimeout(1_500);
      }

      await page
        .locator('[data-testid="login-field-account"], [data-testid="login-field-password"]')
        .first()
        .waitFor({ state: "visible", timeout: 20_000 })
        .catch(() => undefined);
    }

    const usernameInput = await findFirstVisible(page, [
      '[data-testid="login-field-account"]',
      'input[name="username"]',
      'input[name="account"]',
      'input[type="text"]',
      'input[placeholder*="user" i]',
      'input[placeholder*="email" i]',
      'input[placeholder*="phone" i]'
    ]);
    const passwordInput = await findFirstVisible(page, [
      '[data-testid="login-field-password"]',
      'input[name="password"]',
      'input[type="password"]'
    ]);

    if (!usernameInput || !passwordInput) {
      return false;
    }

    await usernameInput.fill("").catch(() => undefined);
    await usernameInput.fill(username);
    await passwordInput.fill("").catch(() => undefined);
    await passwordInput.fill(password);

    const submitButton = await findFirstVisible(page, [
      'button[data-testid="submit-btn"][type="submit"]',
      'button[type="submit"]',
      'button:has-text("Login")'
    ]);
    if (!submitButton) {
      return false;
    }

    let isDisabled = await submitButton.isDisabled().catch(() => false);
    if (isDisabled) {
      await page
        .waitForFunction(
          () => {
            const button = document.querySelector(
              'button[data-testid="submit-btn"][type="submit"]'
            ) as HTMLButtonElement | null;
            return !!button && !button.disabled;
          },
          { timeout: 10_000 }
        )
        .catch(() => undefined);
      isDisabled = await submitButton.isDisabled().catch(() => false);
    }

    if (isDisabled) {
      return false;
    }

    await submitButton.click().catch(() => undefined);
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

async function findFirstVisible(page: Page, selectors: string[]) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      if ((await locator.count()) > 0 && (await locator.isVisible().catch(() => false))) {
        return locator;
      }
    } catch {
      continue;
    }
  }

  return null;
}
