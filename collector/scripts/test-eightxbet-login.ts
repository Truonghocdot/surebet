import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { chromium } from "playwright";
import {
  ensureEightXBetLogin,
  redirectEightXBetSportsHomeToInplay,
  waitForEightXBetAuthenticated
} from "../shared/src/bookmakers/eightxbet-runtime.js";

void main();

async function main() {
  const server = createServer((request, response) => {
    const requestURL = new URL(request.url ?? "/", "http://127.0.0.1");
    const scenario = requestURL.searchParams.get("scenario") ?? "success";
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(
      requestURL.pathname === "/sportEvents/inplay/football"
        ? inplayPage()
        : loginPage(scenario)
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  const address = server.address() as AddressInfo;
  const baseURL = `http://127.0.0.1:${address.port}`;
  const previousEnv = captureEnv([
    "EIGHTXBET_LOGIN_ENABLED",
    "EIGHTXBET_LOGIN_URL",
    "EIGHTXBET_LOGIN_USERNAME",
    "EIGHTXBET_LOGIN_PASSWORD",
    "EIGHTXBET_LOGIN_TIMEOUT_MS",
    "EIGHTXBET_LOGIN_STABLE_MS",
    "EIGHTXBET_LOGIN_ACTION_DELAY_MIN_MS",
    "EIGHTXBET_LOGIN_ACTION_DELAY_MAX_MS",
    "EIGHTXBET_LOGIN_KEYSTROKE_MIN_MS",
    "EIGHTXBET_LOGIN_KEYSTROKE_MAX_MS",
    "EIGHTXBET_POST_LOGIN_POPUP_MS",
    "COLLECTOR_LOGIN_SETTLE_MS",
    "COLLECTOR_LOGIN_TIMEOUT_MS"
  ]);
  const browser = await chromium.launch({ headless: true });

  Object.assign(process.env, {
    EIGHTXBET_LOGIN_ENABLED: "true",
    EIGHTXBET_LOGIN_USERNAME: "test-user",
    EIGHTXBET_LOGIN_PASSWORD: "test-password",
    EIGHTXBET_LOGIN_TIMEOUT_MS: "5000",
    EIGHTXBET_LOGIN_STABLE_MS: "200",
    EIGHTXBET_LOGIN_ACTION_DELAY_MIN_MS: "10",
    EIGHTXBET_LOGIN_ACTION_DELAY_MAX_MS: "10",
    EIGHTXBET_LOGIN_KEYSTROKE_MIN_MS: "2",
    EIGHTXBET_LOGIN_KEYSTROKE_MAX_MS: "2",
    EIGHTXBET_POST_LOGIN_POPUP_MS: "1500",
    COLLECTOR_LOGIN_SETTLE_MS: "250",
    COLLECTOR_LOGIN_TIMEOUT_MS: "5000"
  });

  try {
    const edgePage = await browser.newPage();
    await edgePage.goto(`${baseURL}/login?scenario=edge`, { waitUntil: "domcontentloaded" });
    const edgePasswordField = edgePage.getByTestId("login-field-password");
    await edgePage.evaluate(() => {
      window.setTimeout(() => {
        history.pushState({}, "", "/sportEvents");
        document.querySelector("#app")!.innerHTML = `
          <button data-testid="user-now-balance-btn">
            VND <span data-testid="balance-text">385.98</span>
          </button>
        `;
      }, 240);
    });
    const edgeStartedAt = Date.now();
    await waitForEightXBetAuthenticated(edgePage, edgePasswordField, 250);
    assert.ok(
      Date.now() - edgeStartedAt >= 400,
      "a late authenticated signal must receive its full stability window"
    );
    await edgePage.close();

    const nonSportsHomePage = await browser.newPage();
    await nonSportsHomePage.goto(`${baseURL}/account`, { waitUntil: "domcontentloaded" });
    let invalidRouteObserverAttached = false;
    assert.equal(
      await redirectEightXBetSportsHomeToInplay(
        nonSportsHomePage,
        {
          inplayURL: `${baseURL}/sportEvents/inplay/football`,
          beforeInplayNavigation: () => {
            invalidRouteObserverAttached = true;
          }
        },
        5_000
      ),
      false
    );
    assert.equal(new URL(nonSportsHomePage.url()).pathname, "/account");
    assert.equal(invalidRouteObserverAttached, false);
    await nonSportsHomePage.close();

    process.env.EIGHTXBET_LOGIN_URL = `${baseURL}/login?scenario=success`;
    const successPage = await browser.newPage();
    let observersAttached = false;
    await ensureEightXBetLogin(successPage, {
      inplayURL: `${baseURL}/sportEvents/inplay/football`,
      beforeInplayNavigation: () => {
        observersAttached = true;
      }
    });
    assert.equal(observersAttached, true);
    assert.equal(new URL(successPage.url()).pathname, "/sportEvents/inplay/football");
    assert.equal(await successPage.getByTestId("login-field-password").count(), 0);
    assert.equal(await successPage.getByTestId("balance-text").isVisible(), true);
    const loginMetrics = await successPage.evaluate(() => ({
      accountInputEvents: Number(sessionStorage.getItem("account-input-events") ?? "0"),
      passwordInputEvents: Number(sessionStorage.getItem("password-input-events") ?? "0"),
      redirectDelayMs: Number(document.body.dataset.redirectDelayMs ?? "999999")
    }));
    assert.equal(loginMetrics.accountInputEvents, "test-user".length);
    assert.equal(loginMetrics.passwordInputEvents, "test-password".length);
    assert.ok(
      loginMetrics.redirectDelayMs < 700,
      `in-play navigation must start immediately after stable authentication, got ${loginMetrics.redirectDelayMs}ms`
    );
    assert.equal(
      await successPage.locator("body").getAttribute("data-quick-password-dismissed"),
      "true",
      "the post-login quick-password prompt must be dismissed with Cancel"
    );
    assert.equal(
      await successPage.locator("body").getAttribute("data-announcement-dismissed"),
      "true",
      "the announcement shown after the quick-password prompt must be closed"
    );
    await successPage.close();

    process.env.EIGHTXBET_LOGIN_URL = `${baseURL}/login?scenario=failed`;
    const failedPage = await browser.newPage();
    await assert.rejects(
      () => ensureEightXBetLogin(failedPage),
      /8xbet login did not complete: Invalid credentials/
    );
    await failedPage.close();

    console.log("8xbet stable login and post-login overlay tests passed");
  } finally {
    await browser.close();
    restoreEnv(previousEnv);
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function loginPage(scenario: string) {
  return `
    <main id="app">
      <form id="login-form">
        <input data-testid="login-field-account" type="text">
        <input data-testid="login-field-password" type="password">
        <button data-testid="submit-btn" type="button">Login</button>
      </form>
    </main>
    <script>
      const scenario = ${JSON.stringify(scenario)};
      for (const [testId, metric] of [
        ["login-field-account", "account-input-events"],
        ["login-field-password", "password-input-events"]
      ]) {
        document.querySelector('[data-testid="' + testId + '"]').addEventListener("input", () => {
          const count = Number(sessionStorage.getItem(metric) || "0");
          sessionStorage.setItem(metric, String(count + 1));
        });
      }
      document.querySelector('[data-testid="submit-btn"]').addEventListener("click", () => {
        if (scenario === "failed") {
          const alert = document.createElement("div");
          alert.setAttribute("role", "alert");
          alert.textContent = "Invalid credentials";
          document.querySelector("#login-form").appendChild(alert);
          return;
        }

        history.pushState({}, "", "/sportEvents");
        setTimeout(() => {
          sessionStorage.setItem("authenticated-at", String(Date.now()));
          document.querySelector("#app").innerHTML = ` + "`" + `
            <button data-testid="user-now-balance-btn">
              VND <span data-testid="balance-text">385.98</span>
            </button>
          ` + "`" + `;
        }, 150);
      });
    </script>
  `;
}

function inplayPage() {
  return `
    <main id="app">
      <button data-testid="user-now-balance-btn">
        VND <span data-testid="balance-text">385.98</span>
      </button>
      <section id="quick-password-popup" data-overlay-container="true" data-overlay-type="2" data-overlay-task-id="quick-password-task">
        <section data-overlay-part="content" data-overlay-type="2">
          <p>Quick login password?</p>
          <button data-testid="hint-popup-guide-primary-btn">Confirm</button>
          <button data-testid="hint-popup-guide-primary-btn" id="cancel-quick-password">H&#7911;y</button>
        </section>
      </section>
    </main>
    <script>
      const authenticatedAt = Number(sessionStorage.getItem("authenticated-at") || Date.now());
      document.body.dataset.redirectDelayMs = String(Date.now() - authenticatedAt);
      document.querySelector("#cancel-quick-password").addEventListener("click", () => {
        document.body.dataset.quickPasswordDismissed = "true";
        const oldPopup = document.querySelector("#quick-password-popup");
        oldPopup.style.opacity = "0";
        oldPopup.style.pointerEvents = "none";
        setTimeout(() => {
          document.querySelector("#app").insertAdjacentHTML("beforeend", ` + "`" + `
            <section id="announcement-popup" data-overlay-container="true" data-overlay-type="3" data-overlay-task-id="announcement-task">
              <section data-overlay-part="content" data-overlay-type="3">
                <div data-overlay-action="close" data-testid="announcement-close-button">Close</div>
                <div data-testid="announcementCarousel">Announcement</div>
              </section>
            </section>
          ` + "`" + `);
          document
            .querySelector('[data-testid="announcement-close-button"]')
            .addEventListener("click", () => {
              document.body.dataset.announcementDismissed = "true";
              document.querySelector("#announcement-popup").remove();
            });
        }, 300);
      });
    </script>
  `;
}

function captureEnv(names: string[]) {
  return new Map(names.map((name) => [name, process.env[name]]));
}

function restoreEnv(values: Map<string, string | undefined>) {
  for (const [name, value] of values) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
}
