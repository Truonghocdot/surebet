import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, type BrowserContext, type Locator, type Page } from "playwright";
import {
  BackendSettingsProvider,
  FileSessionStateStore,
  JUN88_LOBBIES,
  envString,
  type Jun88LobbyAccess,
  type SessionState
} from "@surebet/collector-shared";

function resolveLoginURL(baseURL: string) {
  if (baseURL.includes("/login")) {
    return baseURL;
  }

  return `${baseURL.replace(/\/+$/, "")}/vi-vn/login`;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeDebugArtifacts(page: Page, tag: string) {
  const baseDir = path.resolve("tmp/session/debug");
  await mkdir(baseDir, { recursive: true });
  const safeTag = tag.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase();
  const screenshotPath = path.join(baseDir, `${safeTag}.png`);
  const htmlPath = path.join(baseDir, `${safeTag}.html`);

  if (page.isClosed()) {
    console.log(`  debug skipped: page already closed for ${safeTag}`);
    return;
  }

  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
  await writeFile(htmlPath, await page.content(), "utf8").catch(() => undefined);

  console.log(`  debug screenshot: ${screenshotPath}`);
  console.log(`  debug html: ${htmlPath}`);
}

async function tryOpenLoginPopup(page: Page) {
  console.log("Đang tìm popup/form đăng nhập...");

  const popup = page
    .locator('div[class*="_loginPopupContainer_"], form[class*="_fieldContainer_"]')
    .first();
  if (await popup.isVisible().catch(() => false)) {
    console.log("Đã thấy popup/form đăng nhập ngay trên trang.");
    return popup;
  }

  const openers: Array<Locator> = [
    page.getByRole("button", { name: /đăng nhập/i }).first(),
    page.getByText(/đăng nhập/i).first(),
    page.locator('a:has-text("Đăng nhập")').first(),
    page.locator('button:has-text("Đăng nhập")').first()
  ];

  for (const opener of openers) {
    if (await opener.count()) {
      console.log("Đang thử mở popup đăng nhập...");
      await opener.click().catch(() => undefined);
      if (await popup.isVisible().catch(() => false)) {
        console.log("Đã mở được popup đăng nhập.");
        return popup;
      }
    }
  }

  return popup;
}

async function fillLoginForm(page: Page, username: string, password: string) {
  const popup = await tryOpenLoginPopup(page);
  try {
    await popup.waitFor({ state: "visible", timeout: 15_000 });
  } catch (error) {
    await writeDebugArtifacts(page, "login-popup-not-visible");
    throw new Error(`Không thấy popup/form đăng nhập: ${String(error)}`);
  }

  const form = popup.locator("form").first();
  const textInput = form.locator('input[type="text"]').first();
  const passwordInput = form.locator('input[type="password"]').first();

  console.log("Đang chờ ô Tên đăng nhập...");
  await textInput.waitFor({ state: "visible", timeout: 10_000 }).catch(async (error) => {
    await writeDebugArtifacts(page, "login-username-not-found");
    throw new Error(`Không tìm thấy ô Tên đăng nhập: ${String(error)}`);
  });

  console.log("Đang chờ ô Mật khẩu...");
  await passwordInput.waitFor({ state: "visible", timeout: 10_000 }).catch(async (error) => {
    await writeDebugArtifacts(page, "login-password-not-found");
    throw new Error(`Không tìm thấy ô Mật khẩu: ${String(error)}`);
  });

  console.log("Đang tự điền form đăng nhập...");
  await textInput.fill("");
  await textInput.fill(username);
  await passwordInput.fill("");
  await passwordInput.fill(password);

  return {
    popup,
    form,
    submitButton: form.locator('button[type="submit"]').first(),
    turnstile: popup.locator('div[class*="_turnstileWidgetLogin_"]').first()
  };
}

async function attemptLogin(page: Page, username: string, password: string) {
  const { popup, submitButton, turnstile } = await fillLoginForm(
    page,
    username,
    password
  );

  const hasTurnstile = await turnstile.isVisible().catch(() => false);

  console.log("");
  console.log("=== Jun88 login preparation ===");
  console.log(`Đã tự điền username: ${username}`);
  console.log("Đã tự điền password từ cấu hình backend.");

  if (hasTurnstile) {
    console.log("Phát hiện vùng Turnstile.");
    console.log("Bạn cần xử lý captcha/xác minh thủ công trong trình duyệt.");
  } else {
    console.log("Không thấy Turnstile rõ ràng, script sẽ thử bấm đăng nhập tự động.");
  }

  if (!hasTurnstile) {
    await submitButton.click({ timeout: 10_000 }).catch(() => undefined);
  }

  return popup;
}

async function hasActiveSession(page: Page) {
  const userWidget = page
    .locator('div[class*="_userWidget_"], div.userWidget')
    .first();

  return userWidget.isVisible().catch(() => false);
}

async function waitForLoginSuccess(page: Page, timeoutMs: number) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const currentURL = page.url();
    if (currentURL.includes("/vi-vn/home")) {
      console.log("Đã phát hiện redirect về /vi-vn/home.");
      return true;
    }

    if (await hasActiveSession(page)) {
      console.log("Đã phát hiện userWidget sau đăng nhập.");
      return true;
    }

    await sleep(1_000);
  }

  return false;
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

async function waitForDeferredLobbyTarget(
  context: BrowserContext,
  lobby: Jun88LobbyAccess,
  timeoutMs: number
) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    for (const currentPage of context.pages()) {
      const pageURL = currentPage.url();
      if (matchesExpectedOrigin(pageURL, lobby.expectedOriginPatterns)) {
        return {
          finalURL: pageURL,
          finalOrigin: new URL(pageURL).origin,
          source: "page"
        };
      }

      for (const frame of currentPage.frames()) {
        const frameURL = frame.url();
        if (matchesExpectedOrigin(frameURL, lobby.expectedOriginPatterns)) {
          return {
            finalURL: frameURL,
            finalOrigin: new URL(frameURL).origin,
            source: "frame"
          };
        }
      }
    }

    await sleep(1_000);
  }

  return null;
}

async function waitForStableLobbyPage(page: Page) {
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
}

async function openLobby(
  context: BrowserContext,
  lobby: Jun88LobbyAccess,
  attempt = 1
) {
  const existingPages = context.pages().length;
  const page = await context.newPage();
  await page.goto(lobby.launchURL, { waitUntil: "domcontentloaded" });
  await waitForStableLobbyPage(page);

  const betNowButton = page
    .locator('div.btnBet')
    .filter({ hasText: "Cược ngay" })
    .first();

  try {
    await betNowButton.waitFor({ state: "visible", timeout: 20_000 });
  } catch (error) {
    await writeDebugArtifacts(page, `${lobby.lobbyId}-missing-cuoc-ngay-attempt-${attempt}`);
    return {
      success: false,
      lobbyId: lobby.lobbyId,
      finalURL: page.url(),
      finalOrigin: "",
      reason: `Không tìm thấy nút "Cược ngay" cho lobby ${lobby.lobbyId} ở ${lobby.launchURL}: ${String(error)}`
    };
  }

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

  const finalURL = resultPage.url();
  const finalOrigin = (() => {
    try {
      return new URL(finalURL).origin;
    } catch {
      return "";
    }
  })();

  console.log(
    `  -> lobby ${lobby.lobbyId.toUpperCase()} opened: ${lobby.launchURL} -> ${finalURL}`
  );
  console.log(`     origin: ${finalOrigin || "(unknown)"}`);

  if (finalURL.includes("/redirect-error")) {
    await writeDebugArtifacts(resultPage, `${lobby.lobbyId}-maintenance-attempt-${attempt}`);
    return {
      success: false,
      lobbyId: lobby.lobbyId,
      finalURL,
      finalOrigin,
      reason: `Lobby ${lobby.lobbyId} đang bảo trì (redirect tới /redirect-error).`
    };
  }

  if (!matchesExpectedOrigin(finalURL, lobby.expectedOriginPatterns)) {
    if (isCmdIntermediateURL(lobby, finalURL)) {
      console.log(
        "  -> phát hiện URL trung gian của CMD, chờ thêm redirect/iframe sang domain đích..."
      );

      const deferredTarget = await waitForDeferredLobbyTarget(context, lobby, 15_000);
      if (deferredTarget) {
        console.log(
          `  -> CMD resolved via ${deferredTarget.source}: ${deferredTarget.finalURL}`
        );
        return {
          success: true,
          lobbyId: lobby.lobbyId,
          finalURL: deferredTarget.finalURL,
          finalOrigin: deferredTarget.finalOrigin
        };
      }
    }

    await writeDebugArtifacts(resultPage, `${lobby.lobbyId}-unexpected-origin-attempt-${attempt}`);

    if (attempt < 3) {
      console.log(`  -> retry lobby ${lobby.lobbyId.toUpperCase()} (attempt ${attempt + 1}/3)`);
      await resultPage.close().catch(() => undefined);
      if (page !== resultPage) {
        await page.close().catch(() => undefined);
      }
      await sleep(2_000 * attempt);
      return openLobby(context, lobby, attempt + 1);
    }

    return {
      success: false,
      lobbyId: lobby.lobbyId,
      finalURL,
      finalOrigin,
      reason: `Lobby ${lobby.lobbyId} không mở ra đúng domain mong đợi. Final URL: ${finalURL}`
    };
  }

  return {
    success: true,
    lobbyId: lobby.lobbyId,
    finalURL,
    finalOrigin
  };
}

async function main() {
  const backendURL = envString("BACKEND_API_URL", "http://127.0.0.1:8080");
  console.log(`Đang lấy cấu hình jun88 từ backend: ${backendURL}`);
  const provider = new BackendSettingsProvider(backendURL);
  const setting = await provider.getBookmakerSetting("jun88");

  const storageStatePath = path.resolve("tmp/session/jun88-storage-state.json");
  const stateStore = new FileSessionStateStore(path.resolve("tmp/session"));

  console.log("Đang mở trình duyệt Playwright...");
  const browser = await chromium.launch({
    headless: false,
    slowMo: 150
  });

  const context = await browser.newContext();
  const page = await context.newPage();
  const loginURL = resolveLoginURL(setting.url);
  console.log(`Đang mở trang đăng nhập: ${loginURL}`);
  await page.goto(loginURL, { waitUntil: "domcontentloaded" });

  if (await hasActiveSession(page)) {
    console.log("Đã phát hiện userWidget, bỏ qua bước đăng nhập và dùng session hiện có.");
  } else {
    await attemptLogin(page, setting.username, setting.password);
  }

  console.log("");
  console.log("=== Jun88 manual bootstrap ===");
  console.log(`Backend URL: ${backendURL}`);
  console.log(`Login URL: ${loginURL}`);
  console.log("");
  console.log("Script đã tự điền thông tin đăng nhập từ backend config.");

  if (!(await hasActiveSession(page))) {
    console.log("Đang chờ đăng nhập thành công hoặc redirect về /vi-vn/home...");
    const loginReady = await waitForLoginSuccess(page, 30_000);
    if (!loginReady) {
      await writeDebugArtifacts(page, "login-success-timeout");
      throw new Error(
        "Hết thời gian chờ đăng nhập thành công. Không thấy redirect về /vi-vn/home hoặc userWidget xuất hiện."
      );
    }
  }

  console.log("");
  console.log("Đang mở các trang sports landing và bấm Cược ngay...");

  const successfulLobbies: SessionState["accessibleLobbies"] = [];
  const lobbyURLs: Partial<Record<SessionState["accessibleLobbies"][number], string>> = {};
  const failedLobbies: Array<{
    lobbyId: string;
    reason: string;
    finalURL?: string;
  }> = [];

  for (const lobby of JUN88_LOBBIES) {
    console.log(`- Mở ${lobby.lobbyId.toUpperCase()}: ${lobby.launchURL}`);
    const result = await openLobby(context, lobby);
    if (result.success) {
      successfulLobbies.push(result.lobbyId);
      lobbyURLs[result.lobbyId] = result.finalURL;
      continue;
    }

    console.log(`  -> bỏ qua lobby ${lobby.lobbyId.toUpperCase()}: ${result.reason}`);
    failedLobbies.push({
      lobbyId: result.lobbyId,
      reason: result.reason,
      finalURL: result.finalURL
    });
  }

  const visitedOrigins = Array.from(
    new Set(
      context
        .pages()
        .map((currentPage) => {
          try {
            return new URL(currentPage.url()).origin;
          } catch {
            return "";
          }
        })
        .filter(Boolean)
    )
  );

  await context.storageState({ path: storageStatePath });

  const state: SessionState = {
    bookmakerCode: "jun88",
    originURL: setting.url,
    bootstrapMode: "manual",
    preparedAt: new Date().toISOString(),
    storageStatePath,
    accessibleLobbies: successfulLobbies,
    visitedOrigins,
    lobbyURLs
  };

  await stateStore.write(state);

  console.log("");
  console.log("Đã lưu xong session dùng chung cho jun88.");
  console.log(`Storage state: ${storageStatePath}`);
  console.log("Visited origins:");
  for (const origin of visitedOrigins) {
    console.log(`- ${origin}`);
  }
  if (failedLobbies.length > 0) {
    console.log("");
    console.log("Các lobby không mở đúng như mong đợi:");
    for (const lobby of failedLobbies) {
      console.log(`- ${lobby.lobbyId.toUpperCase()}: ${lobby.reason}`);
      if (lobby.finalURL) {
        console.log(`  final URL: ${lobby.finalURL}`);
      }
    }
  }
  console.log("");
  console.log("Bạn có thể đóng trình duyệt thủ công hoặc nhấn CTRL+C.");

  await new Promise(() => {});
}

main().catch((error) => {
  console.error("Manual bootstrap failed:", error);
  process.exit(1);
});
