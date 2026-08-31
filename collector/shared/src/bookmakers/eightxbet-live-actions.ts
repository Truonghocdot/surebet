import type { BrowserContext, Locator, Page } from "playwright";
import type {
  LiveBetHandler,
  LiveBetPrepared,
  LiveBetResult,
  LiveCancelPreparedBetRequest,
  LiveCancelPreparedBetResult,
  LiveCommitBetRequest,
  LivePrepareBetRequest,
  LivePrepareBetResult,
  LiveReconcileBetRequest,
} from "../contracts.js";
import {
  ProcessLiveBetJournal,
  SerialLiveBetActions,
  assertUnexpired,
  liveBetActionTimeoutMs,
  liveBetFeatureFlags,
  liveBetPrepareID,
  liveBetSessionGeneration,
  liveBetSlipFingerprint,
} from "../live-actions.js";
import { envString } from "../core/env.js";
import { readEightXBetAccountBalance } from "./account-balance.js";

type EightXBetPrepared = LiveBetPrepared & {
  request: LivePrepareBetRequest;
};

export class EightXBetLiveBetActions implements LiveBetHandler {
  private actionPage: Page | null = null;
  private readonly prepared = new Map<string, EightXBetPrepared>();
  private readonly journal = new ProcessLiveBetJournal();
  private readonly serial = new SerialLiveBetActions();
  private readonly sessionGeneration = liveBetSessionGeneration("8xbet");

  constructor(private readonly context: BrowserContext) {}

  prepare(request: LivePrepareBetRequest): Promise<LivePrepareBetResult> {
    return this.serial.run(async () => {
      assertUnexpired(request.expiresAt);
      if (!liveBetFeatureFlags().enabled) return rejected("8xbet live actions are disabled");
      const provider = parseProviderRef(request.providerRef);
      if (!provider || provider.fixtureId !== request.fixtureId) {
        return rejected("8xbet provider_ref is invalid or belongs to another fixture");
      }
      if (provider.market !== eightXBetProviderMarket(request.marketId)) {
        return rejected("8xbet provider_ref market does not match the logical market");
      }
      try {
        const page = await this.ensureActionPage(provider.fixtureId);
        await ensureQuickBetOff(page);
        const odds = await findEightXBetOdds(page, request.providerRef, liveBetActionTimeoutMs());
        await odds.click({ timeout: liveBetActionTimeoutMs(), noWaitAfter: true });
        const card = page.getByTestId("sport-cart-single-card").first();
        await card.waitFor({ state: "visible", timeout: liveBetActionTimeoutMs() });
        const slip = await readEightXBetSlip(page, card);
        if (slip.currency.toUpperCase() !== "VND" || slip.rawOdds === null) {
          return rejected("8xbet bet slip currency or odds is unavailable");
        }
        const balanceVnd = await readEightXBetBalanceVnd(page);
        if (balanceVnd <= 0) return rejected("8xbet account balance is unavailable");
        const minimumStakeVnd = 1;
        const maximumStakeVnd = Math.floor(balanceVnd);
        const stakeIncrementVnd = 1;
        const displayedOdds = indonesianToMalay(slip.rawOdds);
        if (displayedOdds === null) return rejected("8xbet displayed odds are invalid");

        const prepareId = liveBetPrepareID(request, this.sessionGeneration);
        const prepared: EightXBetPrepared = {
          result: "prepared",
          request,
          prepareId,
          slipFingerprint: liveBetSlipFingerprint({
            providerRef: request.providerRef,
            cardText: slip.cardText,
            rawOdds: slip.rawOdds,
            currency: slip.currency,
          }),
          displayedOdds,
          rawOdds: slip.rawOdds,
          oddsFormat: "indonesian",
          minimumStakeVnd,
          maximumStakeVnd: Math.min(maximumStakeVnd, balanceVnd),
          stakeIncrementVnd,
          balanceVnd,
          sessionGeneration: this.sessionGeneration,
          observedAt: new Date().toISOString(),
        };
        this.prepared.clear();
        this.prepared.set(prepareId, prepared);
        return publicPrepared(prepared);
      } catch (cause) {
        return rejected(errorMessage(cause));
      }
    });
  }

  commit(request: LiveCommitBetRequest): Promise<LiveBetResult> {
    return this.serial.run(async () => {
      assertUnexpired(request.expiresAt);
      const started = this.journal.begin(request);
      if (started.cached) {
        if (started.entry.result) return started.entry.result;
        return unknown("8xbet commit has an unresolved process-local journal entry");
      }
      const prepared = this.prepared.get(request.prepareId);
      if (!prepared || !sameCorrelation(prepared.request, request)) {
        return this.finish(request, rejected("8xbet commit requires the matching prepared slip"));
      }
      if (!liveBetFeatureFlags().commitEnabled) {
        return this.finish(request, rejected("8xbet live commit is disabled"));
      }
      if (request.stakeVnd % prepared.stakeIncrementVnd !== 0 ||
        request.stakeVnd < prepared.minimumStakeVnd ||
        request.stakeVnd > prepared.maximumStakeVnd ||
        request.stakeVnd > prepared.balanceVnd) {
        return this.finish(request, rejected("8xbet stake is outside the prepared limits or increment"));
      }

      try {
        const page = this.actionPage;
        if (!page || page.isClosed()) {
          return this.finish(request, rejected("8xbet action page is unavailable"));
        }
        await ensureQuickBetOff(page);
        const card = page.getByTestId("sport-cart-single-card").first();
        const slip = await readEightXBetSlip(page, card);
        const currentOdds = slip.rawOdds === null ? null : indonesianToMalay(slip.rawOdds);
        if (currentOdds === null) {
          return this.finish(request, rejected("8xbet slip odds are unavailable"));
        }
        if (Math.abs(currentOdds - request.expectedOdds) > 0.001 || await isAcceptPriceState(page)) {
          return this.finish(request, {
            result: "odds_changed",
            observedAt: new Date().toISOString(),
            submittedOdds: request.expectedOdds,
            offeredOdds: currentOdds,
            confirmationRequired: true,
          });
        }

        await enterEightXBetStake(page, request.stakeVnd);
        // Never click a button labelled "Chấp Nhận" and never submit until the
        // accepted-ticket response/history contract has been captured.
        if (await isAcceptPriceState(page)) {
          const changedSlip = await readEightXBetSlip(page, card);
          const offered = changedSlip.rawOdds === null ? null : indonesianToMalay(changedSlip.rawOdds);
          return this.finish(request, offered === null
            ? rejected("8xbet repriced but the offered odds could not be read")
            : {
                result: "odds_changed",
                observedAt: new Date().toISOString(),
                submittedOdds: request.expectedOdds,
                offeredOdds: offered,
                confirmationRequired: true,
              });
        }
        return this.finish(request, rejected(
          "8xbet submit is blocked until accepted/repriced/rejected network responses are captured",
        ));
      } catch (cause) {
        return this.finish(request, rejected(errorMessage(cause)));
      }
    });
  }

  cancel(request: LiveCancelPreparedBetRequest): Promise<LiveCancelPreparedBetResult> {
    return this.serial.run(async () => {
      assertUnexpired(request.expiresAt);
      const prepared = this.prepared.get(request.prepareId);
      if (!prepared || !sameCorrelation(prepared.request, request)) {
        return { result: "rejected", observedAt: new Date().toISOString(), error: "prepared 8xbet slip was not found" };
      }
      this.prepared.delete(request.prepareId);
      await this.closeActionPage();
      return { result: "cancelled", observedAt: new Date().toISOString() };
    });
  }

  reconcile(request: LiveReconcileBetRequest): Promise<LiveBetResult> {
    return this.serial.run(async () => {
      assertUnexpired(request.expiresAt);
      const entry = this.journal.readForReconcile(request);
      if (entry?.result) return entry.result;
      if (entry?.state === "submit_started") {
        return unknown("8xbet submit result is unresolved; ticket-history reconciliation is required");
      }
      return rejected("8xbet ticket-history reconciliation is not implemented; no submit was performed");
    });
  }

  close() {
    return this.serial.run(() => this.closeActionPage());
  }

  private finish(request: LiveCommitBetRequest, result: LiveBetResult) {
    this.journal.finish(request.idempotencyKey, result);
    return result;
  }

  private async ensureActionPage(fixtureId: string) {
    const target = eightXBetMatchURL(fixtureId);
    let page = this.actionPage;
    if (!page || page.isClosed()) {
      page = await this.context.newPage();
      this.actionPage = page;
    }
    if (new URL(page.url()).pathname !== new URL(target).pathname) {
      await page.goto(target, { waitUntil: "domcontentloaded", timeout: liveBetActionTimeoutMs() });
    }
    await dismissActionPageOverlays(page);
    return page;
  }

  private async closeActionPage() {
    const page = this.actionPage;
    this.actionPage = null;
    await page?.close().catch(() => undefined);
  }
}

async function findEightXBetOdds(page: Page, providerRef: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const candidates = page.locator('button[data-testid^="oddsBtn-"]');
    const count = await candidates.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const candidate = candidates.nth(index);
      const testId = await candidate.getAttribute("data-testid").catch(() => "");
      if (!testId?.endsWith(`|${providerRef}`)) continue;
      if (await candidate.isVisible().catch(() => false) && await candidate.isEnabled().catch(() => false)) {
        return candidate;
      }
    }
    await page.waitForTimeout(100);
  }
  throw new Error(`8xbet provider selection ${providerRef} is unavailable`);
}

async function readEightXBetSlip(page: Page, card: Locator) {
  const cardText = (await card.innerText({ timeout: liveBetActionTimeoutMs() })).trim();
  return {
    cardText,
    rawOdds: parseOdds(cardText),
    currency: (await page.getByTestId("sport-cart-currency-label").first()
      .textContent({ timeout: liveBetActionTimeoutMs() }).catch(() => ""))?.trim() ?? "",
  };
}

async function ensureQuickBetOff(page: Page) {
  const toggle = page.getByTestId("sport-cart-quick-bet-switch").first();
  if (!await toggle.isVisible().catch(() => false)) return;
  const checked = await toggle.getAttribute("aria-checked").catch(() => null);
  const input = toggle.locator('input[type="checkbox"]').first();
  const inputChecked = await input.count().catch(() => 0) > 0
    ? await input.isChecked({ timeout: 250 }).catch(() => false)
    : false;
  if (checked === "true" || inputChecked) {
    await toggle.click({ timeout: 2_000, noWaitAfter: true });
  }
}

async function enterEightXBetStake(page: Page, stakeVnd: number) {
  const calculator = page.getByTestId("SportCalculator").first();
  await calculator.waitFor({ state: "visible", timeout: liveBetActionTimeoutMs() });
  const buttons = calculator.locator("button");
  const amountLabel = page.getByTestId("sport-cart-bet-amount-label").first();
  const backspace = await findEightXBetBackspace(buttons);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const digits = String(await amountLabel.textContent({ timeout: liveBetActionTimeoutMs() }).catch(() => ""))
      .replace(/[^0-9]/g, "");
    if (!digits) break;
    if (!backspace) throw new Error("8xbet keypad backspace is unavailable");
    await backspace.click({ timeout: 2_000, noWaitAfter: true });
  }
  if (String(await amountLabel.textContent({ timeout: liveBetActionTimeoutMs() }).catch(() => ""))
    .replace(/[^0-9]/g, "")) {
    throw new Error("8xbet stake amount could not be cleared");
  }
  for (const digit of String(stakeVnd)) {
    let selected: Locator | null = null;
    const count = await buttons.count();
    for (let index = 0; index < count; index += 1) {
      const candidate = buttons.nth(index);
      if ((await candidate.innerText({ timeout: liveBetActionTimeoutMs() })).trim() === digit) {
        selected = candidate;
        break;
      }
    }
    if (!selected) throw new Error(`8xbet keypad digit ${digit} is unavailable`);
    await selected.click({ timeout: 2_000, noWaitAfter: true });
  }
  const amount = parseMoney(await amountLabel.textContent({ timeout: liveBetActionTimeoutMs() }));
  if (amount !== stakeVnd) throw new Error(`8xbet keypad entered ${amount}, expected ${stakeVnd}`);
}

async function findEightXBetBackspace(buttons: Locator) {
  const count = await buttons.count();
  for (let index = 0; index < count; index += 1) {
    const candidate = buttons.nth(index);
    if ((await candidate.innerText({ timeout: liveBetActionTimeoutMs() })).trim() === "" &&
      await candidate.locator("svg").count() > 0) {
      return candidate;
    }
  }
  return null;
}

async function isAcceptPriceState(page: Page) {
  const button = page.getByTestId("sport-cart-bet-button").first();
  const label = (await button.textContent({ timeout: liveBetActionTimeoutMs() }).catch(() => "")) ?? "";
  return /chấp\s*nhận|chap\s*nhan|accept/i.test(label.normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
}

async function readEightXBetBalanceVnd(page: Page) {
  const balance = await readEightXBetAccountBalance(page);
  return balance?.amountVnd ?? 0;
}

async function dismissActionPageOverlays(page: Page) {
  await page.locator('[data-testid="announcement-close-button"]').first()
    .click({ timeout: 1_000, noWaitAfter: true }).catch(() => undefined);
  const quickCancel = page.getByRole("button", { name: /^(?:Hủy|Cancel)$/i }).first();
  await quickCancel.click({ timeout: 1_000, noWaitAfter: true }).catch(() => undefined);
}

function eightXBetMatchURL(fixtureId: string) {
  const base = new URL(envString("EIGHTXBET_BASE_URL", "https://8x2000.com"));
  base.pathname = `/sportEvents/inplay/football/match/${fixtureId}`;
  base.search = "?tab=all&simpleGameCategory=inplay&type=market";
  base.hash = "";
  return base.toString();
}

function parseProviderRef(value: string) {
  const match = value.match(/^(\d+)\|(ah|ah_1st|ou|ou_1st)\|(h|a|ov|ud)\|(\d+)$/);
  if (!match) return null;
  return { fixtureId: match[1], market: match[2], side: match[3], lineIndex: Number(match[4]) };
}

function eightXBetProviderMarket(marketId: string) {
  switch (marketId) {
    case "hdp-ah": return "ah";
    case "hdp-ah-1st": return "ah_1st";
    case "o-u-ou": return "ou";
    case "o-u-ou-1st": return "ou_1st";
    default: return "";
  }
}

function parseOdds(value: string) {
  const parsed = Number.parseFloat(value.match(/@\s*([+-]?\d+(?:\.\d+)?)/)?.[1] ?? "");
  return Number.isFinite(parsed) ? parsed : null;
}

function indonesianToMalay(value: number) {
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round((value > 1 ? -1 / value : value) * 100) / 100;
}

function parseMoney(value: string | null | undefined) {
  const parsed = Number(String(value ?? "").replace(/[^0-9]/g, ""));
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

function publicPrepared(value: EightXBetPrepared): LiveBetPrepared {
  const { request: _request, ...result } = value;
  return result;
}

function sameCorrelation(left: LivePrepareBetRequest, right: { actionId: string; opportunityId: string; legId: string }) {
  return left.actionId === right.actionId &&
    left.opportunityId === right.opportunityId && left.legId === right.legId;
}

function rejected(error: string): LiveBetResult & { result: "rejected" } {
  return { result: "rejected", observedAt: new Date().toISOString(), error };
}

function unknown(error: string): LiveBetResult {
  return { result: "submission_unknown", observedAt: new Date().toISOString(), error };
}

function errorMessage(value: unknown) {
  return value instanceof Error ? value.message : String(value);
}
