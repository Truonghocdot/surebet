import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright-extra";
import {
  BackendSettingsProvider,
  FileSessionStateStore,
  formatError,
  saveEightXBetSessionStorage,
  envString
} from "@surebet/collector-shared";
import stealth from "puppeteer-extra-plugin-stealth";

async function main() {
  const backendURL = envString("BACKEND_API_URL", "http://127.0.0.1:8080");
  console.log(`Đang lấy cấu hình 8xbet từ backend: ${backendURL}`);

  const provider = new BackendSettingsProvider(backendURL);
  const setting = await provider.getBookmakerSetting("8xbet");
  const stateStore = new FileSessionStateStore(path.resolve("tmp/session"));
  const storageStatePath = path.resolve("tmp/session/8xbet-storage-state.json");
  const sessionStoragePath = path.resolve("tmp/session/8xbet-session-storage.json");
  chromium.use(stealth());
  console.log("Đang mở trình duyệt Playwright cho 8xbet...");
  const browser = await chromium.launch({
    headless: false,
    slowMo: 150,
    args: [
      '--disable-blink-features=AutomationControlled',
    ]
  });

  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    locale: "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
    extraHTTPHeaders: {
      "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7"
    }
  });
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
  const page = await context.newPage();

  console.log(`Đang mở site 8xbet: ${setting.url}`);
  await page.goto(setting.url, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);

  const loginAttempted = await tryAutoLogin(page, setting.username, setting.password);
  const autoLoginSucceeded = await waitForSportEvents(page, 12_000);

  console.log("");
  console.log("=== 8xbet manual bootstrap ===");
  console.log(`Backend URL: ${backendURL}`);
  console.log(`Target URL: ${page.url()}`);
  console.log("");
  if (autoLoginSucceeded) {
    console.log("Đã phát hiện redirect sang /sportEvents, coi như login thành công tự động.");
  } else if (loginAttempted) {
    console.log("Script đã thử mở flow login và điền credential tự động.");
  } else {
    console.log("Script chưa thấy đủ flow login động để tự submit.");
  }
  if (!autoLoginSucceeded) {
    console.log("Nếu Cloudflare/challenge xuất hiện, hãy hoàn tất thủ công ngay trên trình duyệt.");
    console.log("Sau khi bạn đã vào được site hoặc tới trang sau-login mong muốn, nhấn ENTER ở terminal này.");
    await waitForEnter();
  }

  await persistEightXBetSession(context, page, stateStore, storageStatePath, sessionStoragePath);

  console.log("");
  console.log("Đã lưu xong session 8xbet.");
  console.log(`Storage state: ${storageStatePath}`);
  console.log(`Session storage: ${sessionStoragePath}`);
  console.log("Visited URLs:");
  for (const currentPage of context.pages()) {
    console.log(`- ${currentPage.url()}`);
  }

  console.log("");
  console.log("Bạn có thể đóng trình duyệt thủ công hoặc nhấn CTRL+C.");
}

async function waitForEnter() {
  await new Promise<void>((resolve) => {
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    process.stdin.once("data", () => {
      resolve();
    });
  });
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
  stateStore: FileSessionStateStore,
  storageStatePath: string,
  sessionStoragePath: string
) {
  await context.storageState({ path: storageStatePath });
  await saveEightXBetSessionStorage(
    sessionStoragePath,
    await page.evaluate(() => {
      const output: Record<string, string> = {};
      for (let index = 0; index < window.sessionStorage.length; index += 1) {
        const key = window.sessionStorage.key(index);
        if (!key) {
          continue;
        }
        output[key] = window.sessionStorage.getItem(key) ?? "";
      }
      return output;
    })
  );
  await stateStore.write({
    bookmakerCode: "8xbet",
    originURL: page.url(),
    bootstrapMode: "manual",
    preparedAt: new Date().toISOString(),
    storageStatePath,
    sessionStoragePath,
    accessibleLobbies: ["default"],
    visitedOrigins: Array.from(new Set(context.pages().map((currentPage) => currentPage.url())))
  });
}

main().catch((error) => {
  console.error("8xbet bootstrap failed:", error);
  process.exit(1);
});

async function tryAutoLogin(page: Page, username: string, password: string) {
  try {
    console.log("Đang dò luồng login 8xbet...");

    const primaryLoginButton = page
      .locator('button[data-testid="submit-btn"][type="button"]')
      .filter({ hasText: /^Login$/i })
      .first();

    console.log("Đang chờ màn đầu render nút Login...");
    await primaryLoginButton.waitFor({ state: "visible", timeout: 20_000 }).catch(() => undefined);
    if (!(await primaryLoginButton.isVisible().catch(() => false))) {
      console.log("Không thấy nút Login ở màn đầu.");
      return false;
    }

    console.log("Đã thấy nút Login chính, đang click...");
    await primaryLoginButton.click().catch(() => undefined);
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
    await page.waitForTimeout(2_000);

    console.log("Đang chờ form login render ra...");
    const directAccountField = page.locator('[data-testid="login-field-account"]').first();
    const directPasswordField = page.locator('[data-testid="login-field-password"]').first();

    const directFormReady = await directAccountField
      .waitFor({ state: "visible", timeout: 8_000 })
      .then(async () => directPasswordField.isVisible().catch(() => false))
      .catch(() => false);

    if (!directFormReady) {
      const emailMethod = page.locator('[data-testid="login-email"]').first();
      if (await emailMethod.isVisible().catch(() => false)) {
        console.log("Form chưa hiện trực tiếp, thử click login-email...");
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
      console.log("Chưa thấy đủ input username/password sau khi chờ form login render.");
      return false;
    }

    console.log("Đã thấy form login, đang điền credential...");
    await usernameInput.fill("").catch(() => undefined);
    await usernameInput.fill(username);
    await passwordInput.fill("").catch(() => undefined);
    await passwordInput.fill(password);

    const submitButton = await findFirstVisible(page, [
      'button[data-testid="submit-btn"][type="submit"]',
      'button[type="submit"]',
      'button:has-text("Login")'
    ]);
    if (submitButton) {
      console.log("Đang submit login form...");
      let isDisabled = await submitButton.isDisabled().catch(() => false);
      if (isDisabled) {
        console.log("Nút submit đang disabled, chờ form validate...");
        await page.waitForFunction(
          () => {
            const button = document.querySelector(
              'button[data-testid="submit-btn"][type="submit"]'
            ) as HTMLButtonElement | null;
            return !!button && !button.disabled;
          },
          { timeout: 10_000 }
        ).catch(() => undefined);
        isDisabled = await submitButton.isDisabled().catch(() => false);
      }

      if (isDisabled) {
        console.log("Nút submit vẫn disabled sau khi chờ validate.");
        return false;
      }

      await submitButton.click().catch(() => undefined);
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
    } else {
      console.log("Không thấy submit button rõ ràng sau khi điền form.");
    }

    return true;
  } catch (error) {
    console.log(`Auto login 8xbet gặp lỗi: ${formatError(error)}`);
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
