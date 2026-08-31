import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { chromium } from "playwright";
import {
  findJun88LoginSubmitButton,
  waitForJun88DirectLoginForm,
  waitForJun88LoginForm,
  withJun88BookmakerPage
} from "../shared/src/bookmakers/jun88-bookmaker-page.js";

void main();

async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <main id="app"></main>
      <div class="announcement-overlay">
        <div class="multi-announcement-close">close</div>
        <div class="announcement-click-shield"></div>
      </div>
      <style>
        .announcement-overlay {
          position: fixed;
          inset: 0;
          z-index: 10;
          background: white;
        }
        .multi-announcement-close {
          position: fixed;
          top: 20px;
          right: 20px;
          width: 50px;
          height: 50px;
        }
        .announcement-click-shield {
          position: fixed;
          inset: 0;
          z-index: 11;
        }
      </style>
      <script>
        document.querySelector(".multi-announcement-close").addEventListener("click", () => {
          document.querySelector(".announcement-overlay").remove();
        });
        setTimeout(() => {
          const button = document.createElement("button");
          button.className = "_btnLogin_test";
          button.textContent = "Đăng Nhập";
          button.addEventListener("click", () => {
            setTimeout(() => {
              document.querySelector("#app").innerHTML = ` + "`" + `
                <form>
                  <input name="username" type="text">
                  <input name="password" type="password">
                  <button type="submit">ĐĂNG NHẬP PHIÊN BẢN 2</button>
                </form>
              ` + "`" + `;
            }, 250);
          });
          document.querySelector("#app").appendChild(button);
        }, 250);
      </script>
    `);

    const startedAt = Date.now();
    const passwordField = await waitForJun88LoginForm(page, 2_000);
    assert.equal(await passwordField.isVisible(), true);
    assert.equal(
      await page.locator(".multi-announcement-close").count(),
      0,
      "Jun88 login helper must dismiss the announcement before clicking login"
    );
    assert.ok(
      Date.now() - startedAt >= 400,
      "Jun88 login helper must wait for the delayed entry button and delayed form"
    );
    const submitButton = await findJun88LoginSubmitButton(passwordField);
    assert.equal(
      await submitButton?.textContent(),
      "ĐĂNG NHẬP PHIÊN BẢN 2",
      "Jun88 submit lookup must stay inside the rendered login form"
    );

    await page.setContent("<main id=\"app\"></main>");
    await page.evaluate(() => {
      setTimeout(() => {
        document.querySelector("#app")!.innerHTML =
          '<form><input type="password"><button>Login</button></form>';
      }, 200);
    });
    assert.equal(await (await waitForJun88LoginForm(page, 1_000)).isVisible(), true);

    await page.setContent("<main></main>");
    await assert.rejects(
      () => waitForJun88LoginForm(page, 250),
      /after waiting .*url=about:blank ready_state=complete/
    );

    await page.setContent(`
      <button id="home-login">Login</button>
      <main id="app"></main>
      <script>
        document.querySelector("#home-login").addEventListener("click", () => {
          document.querySelector("#app").innerHTML = '<input type="password">';
        });
      </script>
    `);
    await assert.rejects(
      () => waitForJun88DirectLoginForm(page, 250),
      /Jun88 direct login form was not rendered/
    );
    assert.equal(
      await page.locator('input[type="password"]').count(),
      0,
      "direct login flow must not click a Home-page login entry button"
    );

    await testAuthenticatedTabIsReused();
    console.log("Jun88 delayed login render tests passed");
  } finally {
    await browser.close();
  }
}

async function testAuthenticatedTabIsReused() {
  const requestedPaths: string[] = [];
  const server = createServer((request, response) => {
    const requestURL = new URL(request.url || "/", "http://127.0.0.1");
    requestedPaths.push(requestURL.pathname);
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    if (requestURL.pathname === "/login") {
      response.end(`
        <form id="login-form">
          <input name="username" type="text">
          <input name="password" type="password">
          <button type="submit">Login</button>
        </form>
        <script>
          document.querySelector("#login-form").addEventListener("submit", (event) => {
            event.preventDefault();
            document.querySelector("#login-form").remove();
            history.replaceState({}, "", "/authenticated");
            setTimeout(() => {
              sessionStorage.setItem("jun88-session", "authenticated");
            }, 150);
          });
        </script>
      `);
      return;
    }
    if (request.url === "/home") {
      response.end(`
        <button id="open-login">Đăng Nhập</button>
        <div id="modal"></div>
        <script>
          document.querySelector("#open-login").addEventListener("click", () => {
            document.querySelector("#modal").innerHTML = ` + "`" + `
              <form id="login-form">
                <input type="text">
                <input type="password">
                <button type="submit">ĐĂNG NHẬP PHIÊN BẢN 2</button>
              </form>
            ` + "`" + `;
            document.querySelector("#login-form").addEventListener("submit", (event) => {
              event.preventDefault();
              document.querySelector("#modal").innerHTML = "";
              setTimeout(() => {
                sessionStorage.setItem("jun88-session", "authenticated");
              }, 150);
            });
          });
        </script>
      `);
      return;
    }

    response.end("<main>CMD lobby</main>");
  });
  await new Promise<void>((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));

  const address = server.address() as AddressInfo;
  const baseURL = `http://127.0.0.1:${address.port}`;
  const previousEnv = {
    enabled: process.env.JUN88_LOGIN_ENABLED,
    loginURL: process.env.JUN88_LOGIN_URL,
    username: process.env.JUN88_LOGIN_USERNAME,
    password: process.env.JUN88_LOGIN_PASSWORD,
    settleMs: process.env.COLLECTOR_LOGIN_SETTLE_MS,
    pageSettleMs: process.env.COLLECT_PAGE_SETTLE_MS
  };

  Object.assign(process.env, {
    JUN88_LOGIN_ENABLED: "true",
    JUN88_LOGIN_URL: `${baseURL}/login`,
    JUN88_LOGIN_USERNAME: "test-user",
    JUN88_LOGIN_PASSWORD: "test-password",
    COLLECTOR_LOGIN_SETTLE_MS: "250",
    COLLECT_PAGE_SETTLE_MS: "0"
  });

  try {
    await withJun88BookmakerPage(
      {
        lobbyId: "cmd",
        launchURL: `${baseURL}/sports-landing/cmd`,
        loginURL: `${baseURL}/login`,
        expectedOriginPatterns: [`127.0.0.1:${address.port}`]
      },
      `${baseURL}/sports-landing/cmd`,
      async (page) => {
        assert.equal(
          await page.evaluate(() => sessionStorage.getItem("jun88-session")),
          "authenticated",
          "Jun88 CMD must continue in the authenticated tab so sessionStorage survives"
        );
        assert.equal(new URL(page.url()).pathname, "/sports-landing/cmd");
      }
    );
    assert.equal(
      requestedPaths.filter((path) => path === "/login").length,
      1,
      "Jun88 must open the direct login route exactly once"
    );
    assert.equal(
      requestedPaths.includes("/home"),
      false,
      "Jun88 must not visit Home before login"
    );
    assert.equal(
      requestedPaths.includes("/sports-landing/cmd"),
      true,
      "Jun88 must open the CMD bookmaker after authentication"
    );
  } finally {
    restoreEnv("JUN88_LOGIN_ENABLED", previousEnv.enabled);
    restoreEnv("JUN88_LOGIN_URL", previousEnv.loginURL);
    restoreEnv("JUN88_LOGIN_USERNAME", previousEnv.username);
    restoreEnv("JUN88_LOGIN_PASSWORD", previousEnv.password);
    restoreEnv("COLLECTOR_LOGIN_SETTLE_MS", previousEnv.settleMs);
    restoreEnv("COLLECT_PAGE_SETTLE_MS", previousEnv.pageSettleMs);
    await new Promise<void>((resolvePromise, reject) => {
      server.close((error) => error ? reject(error) : resolvePromise());
    });
  }
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
