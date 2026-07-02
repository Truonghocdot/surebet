import type { CollectContext, CollectorRuntime, OddsSnapshot } from "../contracts.js";
import { collectorLaunchOptions } from "../core/browser.js";
import { writeDebugArtifacts } from "../core/debug.js";
import { parseEightXBetIncomingSnapshot } from "./parsers/eightxbet-incoming-parser.js";
import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import {
  loadEightXBetLocalStorage,
  loadEightXBetSessionStorage,
  saveEightXBetLocalStorage,
  saveEightXBetSessionStorage
} from "../session/eightxbet-session-storage.js";

const EIGHTXBET_INCOMING_PATH = "/sportEvents/incoming/football?hour=6";
const EIGHTXBET_READY_SELECTOR = '[data-testid^="v4-sport-asia-simple-handicap-unit-"]';
const EIGHTXBET_INFINITE_SCROLL_BOTTOM = '[data-testid="v4-sport-simple-handicap-infinite-scroll-bottom"]';
const EIGHTXBET_CARD_SELECTOR = '[data-testid^="simple-handicap-layout-football-"]';
const EIGHTXBET_ODDS_BUTTON_SELECTOR = 'button[data-testid^="oddsBtn-"]';
const EIGHTXBET_TEAM_SELECTOR = `${EIGHTXBET_CARD_SELECTOR} small.text-text-2`;
const EIGHTXBET_HUMAN_SCROLL_PATTERN = [110, 140, 155, 175];
const EIGHTXBET_HUMAN_SCROLL_PAUSES_MS = [180, 260, 220, 320];

chromium.use(stealth());

export class EightXBetRuntime implements CollectorRuntime {
  constructor(private readonly collectorId: string) {}

  async collect(context: CollectContext) {
    if (!context.session) {
      throw new Error(
        `8xbet runtime requires a prepared session. Run "npm run bootstrap:8xbet" first.`
      );
    }

    const browser = await chromium.launch(collectorLaunchOptions(true));
    let page: import("playwright").Page | null = null;

    try {
      const sessionValues = context.session.sessionStoragePath
        ? await loadEightXBetSessionStorage(context.session.sessionStoragePath).catch(() => null)
        : null;
      const localValues = context.session.localStoragePath
        ? await loadEightXBetLocalStorage(context.session.localStoragePath).catch(() => null)
        : null;

      const contextPage = await browser.newContext({
        storageState: context.session.storageStatePath,
        locale: "vi-VN",
        timezoneId: "Asia/Ho_Chi_Minh",
        extraHTTPHeaders: {
          "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7"
        }
      });
      await contextPage.addInitScript(() => {
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
      await installEightXBetStorageInitScript(contextPage, {
        sessionEntries: sessionValues,
        localEntries: localValues
      });
      page = await contextPage.newPage();

      const targetURL = new URL(EIGHTXBET_INCOMING_PATH, context.setting.url).toString();

      if (sessionValues || localValues) {
        await page.goto(new URL("/sportEvents", context.setting.url).toString(), {
          waitUntil: "domcontentloaded"
        });
        await page.evaluate(
          ({ sessionEntries, localEntries }) => {
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
          },
          {
            sessionEntries: sessionValues,
            localEntries: localValues
          }
        );
        await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);

        const restoredState = await readEightXBetAuthState(page);

        if (!restoredState.hasAccessToken || !restoredState.hasRefreshToken) {
          throw new Error(
            `8xbet auth tokens were not restored correctly (access-token=${restoredState.hasAccessToken}, refresh-token=${restoredState.hasRefreshToken}, tt_sessionId=${restoredState.hasSessionId}).`
          );
        }
      }

      await page.goto(targetURL, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
      let ready = await page.waitForSelector(EIGHTXBET_READY_SELECTOR, { timeout: 20_000 }).then(
        () => true,
        () => false
      );

      if (!ready) {
        await page.goto(new URL("/sportEvents", context.setting.url).toString(), {
          waitUntil: "domcontentloaded"
        });
        await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
        await page.goto(targetURL, { waitUntil: "domcontentloaded" });
        await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
        ready = await page.waitForSelector(EIGHTXBET_READY_SELECTOR, { timeout: 20_000 }).then(
          () => true,
          () => false
        );
      }

      if (!ready) {
        throw new Error("8xbet incoming list did not render after session restore.");
      }
      await autoScrollIncomingList(page);
      const renderState = await stabilizeIncomingList(page);
      if (renderState.oddsButtonCount === 0 || renderState.teamLabelCount < 2) {
        await writeDebugArtifacts(page, `${this.collectorId}-incoming-not-hydrated`);
        throw new Error(
          "8xbet incoming list rendered shell rows, but odds buttons did not hydrate in time."
        );
      }
      await persistEightXBetRuntimeSession(contextPage, page, context.session);

      const html = await page.content();
      const snapshot = parseEightXBetIncomingSnapshot(html, page.url(), this.collectorId);
      if (isRawFallbackSnapshot(snapshot)) {
        await writeDebugArtifacts(page, `${this.collectorId}-raw-fallback`);
        throw new Error(
          "8xbet parser returned only raw-card fallback; live odds buttons were not extracted."
        );
      }
      return snapshot;
    } catch (error) {
      if (page) {
        await writeDebugArtifacts(page, `${this.collectorId}-collect-failed`);
      }
      throw error;
    } finally {
      await browser.close();
    }
  }
}

type EightXBetStoragePayload = {
  sessionEntries: Record<string, string> | null;
  localEntries: Record<string, string> | null;
};

async function installEightXBetStorageInitScript(
  context: import("playwright").BrowserContext,
  payload: EightXBetStoragePayload
) {
  if (!payload.sessionEntries && !payload.localEntries) {
    return;
  }

  await context.addInitScript(({ sessionEntries, localEntries }: EightXBetStoragePayload) => {
    try {
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
    } catch {}
  }, payload);
}

function isRawFallbackSnapshot(snapshot: OddsSnapshot) {
  return (
    snapshot.selections.length > 0 &&
    snapshot.selections.every((selection) => selection.marketId === "raw-card")
  );
}

async function readEightXBetAuthState(page: import("playwright").Page) {
  return page.evaluate(() => {
    const authKeys = ["access-token", "refresh-token"];
    for (const key of authKeys) {
      const localValue = window.localStorage.getItem(key);
      const sessionValue = window.sessionStorage.getItem(key);
      const value = localValue || sessionValue;
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
        !!window.sessionStorage.getItem("refresh-token"),
      hasSessionId:
        !!window.sessionStorage.getItem("tt_sessionId") ||
        !!window.localStorage.getItem("tt_sessionId"),
      currentPath: window.location.pathname
    };
  });
}

async function persistEightXBetRuntimeSession(
  context: import("playwright").BrowserContext,
  page: import("playwright").Page,
  session: NonNullable<CollectContext["session"]>
) {
  await context.storageState({ path: session.storageStatePath }).catch(() => undefined);

  if (session.sessionStoragePath) {
    const sessionStorageValues = await page.evaluate(() => {
      const output: Record<string, string> = {};
      for (let index = 0; index < window.sessionStorage.length; index += 1) {
        const key = window.sessionStorage.key(index);
        if (key) {
          output[key] = window.sessionStorage.getItem(key) ?? "";
        }
      }
      return output;
    });
    await saveEightXBetSessionStorage(session.sessionStoragePath, sessionStorageValues).catch(
      () => undefined
    );
  }

  if (session.localStoragePath) {
    const localStorageValues = await page.evaluate(() => {
      const output: Record<string, string> = {};
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index);
        if (key) {
          output[key] = window.localStorage.getItem(key) ?? "";
        }
      }
      return output;
    });
    await saveEightXBetLocalStorage(session.localStoragePath, localStorageValues).catch(
      () => undefined
    );
  }
}

async function autoScrollIncomingList(page: import("playwright").Page) {
  let previousState = await readIncomingListState(page);

  for (let cycle = 0; cycle < 5; cycle += 1) {
    await performHumanScrollCycle(page, cycle);

    const nextState = await waitForHydrationProgress(page, previousState);
    const countsAdvanced =
      nextState.cardCount > previousState.cardCount ||
      nextState.oddsButtonCount > previousState.oddsButtonCount ||
      nextState.teamLabelCount > previousState.teamLabelCount;

    previousState = nextState;
    if (countsAdvanced) {
      await page.waitForTimeout(450);
    } else if (nextState.bottomVisible || nextState.atEnd) {
      await page.waitForTimeout(650);
    } else {
      await page.waitForTimeout(300);
    }

    if ((nextState.bottomVisible || nextState.atEnd) && nextState.oddsButtonCount > 0) {
      return;
    }
  }
}

async function stabilizeIncomingList(page: import("playwright").Page) {
  let previousState = await readIncomingListState(page);
  let stableRounds = 0;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.waitForTimeout(550);

    const currentState = await readIncomingListState(page);
    const countsStable =
      currentState.cardCount === previousState.cardCount &&
      currentState.oddsButtonCount === previousState.oddsButtonCount &&
      currentState.teamLabelCount === previousState.teamLabelCount;

    if (countsStable && currentState.oddsButtonCount > 0) {
      stableRounds += 1;
    } else {
      stableRounds = 0;
    }

    if (stableRounds >= 2) {
      return currentState;
    }

    if (!currentState.atEnd && !currentState.bottomVisible) {
      await performHumanScrollCycle(page, attempt + 20, 1);
    }

    previousState = currentState;
  }

  return previousState;
}

type EightXBetIncomingListState = {
  cardCount: number;
  oddsButtonCount: number;
  teamLabelCount: number;
  bottomVisible: boolean;
  atEnd: boolean;
};

async function readIncomingListState(page: import("playwright").Page): Promise<EightXBetIncomingListState> {
  return page.evaluate(
    ({ bottomSelector, cardSelector, oddsSelector, teamSelector }) => {
      const bottomNode = document.querySelector(bottomSelector);
      const bottomRect = bottomNode?.getBoundingClientRect();
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
      const scrollElement = document.scrollingElement || document.documentElement;
      const scrollTop = scrollElement?.scrollTop ?? window.scrollY ?? 0;
      const scrollHeight = scrollElement?.scrollHeight ?? 0;

      return {
        cardCount: document.querySelectorAll(cardSelector).length,
        oddsButtonCount: document.querySelectorAll(oddsSelector).length,
        teamLabelCount: document.querySelectorAll(teamSelector).length,
        bottomVisible: !!bottomRect && bottomRect.top <= viewportHeight + 24,
        atEnd: scrollTop + viewportHeight >= scrollHeight - 24
      };
    },
    {
      bottomSelector: EIGHTXBET_INFINITE_SCROLL_BOTTOM,
      cardSelector: EIGHTXBET_CARD_SELECTOR,
      oddsSelector: EIGHTXBET_ODDS_BUTTON_SELECTOR,
      teamSelector: EIGHTXBET_TEAM_SELECTOR
    }
  );
}

async function performHumanScrollCycle(
  page: import("playwright").Page,
  cycle: number,
  steps = EIGHTXBET_HUMAN_SCROLL_PATTERN.length
) {
  for (let stepIndex = 0; stepIndex < steps; stepIndex += 1) {
    const patternIndex = (cycle + stepIndex) % EIGHTXBET_HUMAN_SCROLL_PATTERN.length;
    const scrollDelta = EIGHTXBET_HUMAN_SCROLL_PATTERN[patternIndex];
    const pauseMs = EIGHTXBET_HUMAN_SCROLL_PAUSES_MS[patternIndex];

    const wheeled = await page.mouse.wheel(0, scrollDelta).then(
      () => true,
      () => false
    );
    if (!wheeled) {
      await page.evaluate((delta) => {
        window.scrollBy(0, delta);
      }, scrollDelta).catch(() => undefined);
    }
    await page.waitForTimeout(pauseMs);
  }
}

async function waitForHydrationProgress(
  page: import("playwright").Page,
  baseline: EightXBetIncomingListState
) {
  let best = baseline;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await page.waitForTimeout(240 + attempt * 120);
    const current = await readIncomingListState(page);
    if (
      current.cardCount > best.cardCount ||
      current.oddsButtonCount > best.oddsButtonCount ||
      current.teamLabelCount > best.teamLabelCount
    ) {
      best = current;
    } else if (current.bottomVisible || current.atEnd) {
      best = current;
    }

    if (best.oddsButtonCount > baseline.oddsButtonCount && best.teamLabelCount >= 2) {
      return best;
    }

    if ((best.bottomVisible || best.atEnd) && best.oddsButtonCount > 0) {
      return best;
    }
  }

  return best;
}
