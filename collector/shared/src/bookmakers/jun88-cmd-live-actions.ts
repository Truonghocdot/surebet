import type { Frame, Locator, Page } from "playwright";
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
import { JUN88_VD_TO_VND, readJun88CmdAccountBalance } from "./account-balance.js";

const JUN88_ODDS_SELECTOR = 'a.odds[href*="OddsClick"]';

type Jun88Prepared = LiveBetPrepared & {
  request: LivePrepareBetRequest;
  stakeUnitVnd: number;
};

export class Jun88CmdLiveBetActions implements LiveBetHandler {
  private readonly prepared = new Map<string, Jun88Prepared>();
  private readonly journal = new ProcessLiveBetJournal();
  private readonly serial = new SerialLiveBetActions();
  private readonly sessionGeneration = liveBetSessionGeneration("jun88-cmd");

  constructor(private readonly page: Page) {}

  prepare(request: LivePrepareBetRequest): Promise<LivePrepareBetResult> {
    return this.serial.run(async () => {
      assertUnexpired(request.expiresAt);
      if (!liveBetFeatureFlags().enabled) return rejected("Jun88 live actions are disabled");
      if (!validJun88ProviderRef(request.providerRef)) {
        return rejected("Jun88 provider_ref is invalid");
      }
      const stakeUnitVnd = JUN88_VD_TO_VND;

      try {
        if (!await jun88SelectionIdentityMatches(this.page, request)) {
          return rejected("Jun88 logical selection does not match provider_ref in the live observer");
        }
        const odds = await findJun88Odds(this.page, request.providerRef, liveBetActionTimeoutMs());
        const selectedRawOdds = parseDecimal(await odds.locator.textContent({ timeout: liveBetActionTimeoutMs() }));
        if (selectedRawOdds === null) return rejected("Jun88 selection has no valid Malay odds");
        await odds.locator.click({ timeout: liveBetActionTimeoutMs(), noWaitAfter: true });
        const sidebar = await findJun88Sidebar(this.page, liveBetActionTimeoutMs());
        const slip = await readJun88Slip(sidebar.frame);
        if (slip.oddsType.toUpperCase() !== "MY") {
          return rejected(`Jun88 slip odds format is ${slip.oddsType || "unknown"}, expected MY`);
        }
        if (slip.rawOdds === null || slip.minimumStake === null || slip.maximumStake === null) {
          return rejected("Jun88 slip did not expose odds and stake limits");
        }
        if (Math.abs(selectedRawOdds - slip.rawOdds) > 0.001) {
          return rejected("Jun88 clicked odds and sidebar odds do not match");
        }
        const balanceVnd = await readJun88BalanceVnd(this.page);
        if (balanceVnd <= 0) return rejected("Jun88 account balance is unavailable");

        const prepareId = liveBetPrepareID(request, this.sessionGeneration);
        const result: Jun88Prepared = {
          result: "prepared",
          request,
          prepareId,
          slipFingerprint: liveBetSlipFingerprint({
            providerRef: request.providerRef,
            team: slip.team,
            handicap: slip.handicap,
            score: slip.score,
            betType: slip.betType,
            rawOdds: slip.rawOdds,
            minimumStake: slip.minimumStake,
            maximumStake: slip.maximumStake,
          }),
          displayedOdds: slip.rawOdds,
          rawOdds: slip.rawOdds,
          oddsFormat: "malay",
          minimumStakeVnd: Math.round(slip.minimumStake * stakeUnitVnd),
          maximumStakeVnd: Math.round(slip.maximumStake * stakeUnitVnd),
          stakeIncrementVnd: stakeUnitVnd,
          balanceVnd,
          sessionGeneration: this.sessionGeneration,
          observedAt: new Date().toISOString(),
          stakeUnitVnd,
        };
        this.prepared.clear();
        this.prepared.set(prepareId, result);
        return publicPrepared(result);
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
        return unknown("Jun88 commit has an unresolved process-local journal entry");
      }
      const prepared = this.prepared.get(request.prepareId);
      if (!prepared || !sameCorrelation(prepared.request, request)) {
        return this.finish(request, rejected("Jun88 commit requires the matching prepared slip"));
      }
      if (!liveBetFeatureFlags().commitEnabled) {
        return this.finish(request, rejected("Jun88 live commit is disabled"));
      }
      if (request.stakeVnd % prepared.stakeUnitVnd !== 0 ||
        request.stakeVnd < prepared.minimumStakeVnd ||
        request.stakeVnd > prepared.maximumStakeVnd ||
        request.stakeVnd > prepared.balanceVnd) {
        return this.finish(request, rejected("Jun88 stake is outside the prepared limits or increment"));
      }

      try {
        const sidebar = await findJun88Sidebar(this.page, liveBetActionTimeoutMs());
        const slip = await readJun88Slip(sidebar.frame);
        if (slip.rawOdds === null) {
          return this.finish(request, rejected("Jun88 slip odds are unavailable"));
        }
        if (Math.abs(slip.rawOdds - request.expectedOdds) > 0.001) {
          return this.finish(request, {
            result: "odds_changed",
            observedAt: new Date().toISOString(),
            submittedOdds: request.expectedOdds,
            offeredOdds: slip.rawOdds,
            confirmationRequired: true,
          });
        }

        const displayStake = String(request.stakeVnd / prepared.stakeUnitVnd);
        const stake = sidebar.frame.locator("#tx_stake").first();
        await stake.click({ timeout: liveBetActionTimeoutMs() });
        await stake.press(process.platform === "darwin" ? "Meta+A" : "Control+A", {
          timeout: liveBetActionTimeoutMs(),
        });
        await stake.type(displayStake, { delay: 20, timeout: liveBetActionTimeoutMs() });
        await stake.press("Tab", { timeout: liveBetActionTimeoutMs() });
        if ((await stake.inputValue({ timeout: liveBetActionTimeoutMs() })).replace(/[,\s]/g, "") !== displayStake) {
          return this.finish(request, rejected("Jun88 stake field did not retain the requested amount"));
        }

        // Captures do not identify a definitive accepted-ticket response. Stop
        // before #btnBet rather than claiming a ticket or risking a blind retry.
        return this.finish(request, rejected(
          "Jun88 submit is blocked until accepted/repriced/rejected network responses are captured",
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
        return { result: "rejected", observedAt: new Date().toISOString(), error: "prepared Jun88 slip was not found" };
      }
      const sidebar = await findJun88Sidebar(this.page, 2_000).catch(() => null);
      if (sidebar) {
        await sidebar.frame.locator("#btnCancel").first().click({ timeout: 2_000, noWaitAfter: true })
          .catch(() => undefined);
      }
      this.prepared.delete(request.prepareId);
      return { result: "cancelled", observedAt: new Date().toISOString() };
    });
  }

  reconcile(request: LiveReconcileBetRequest): Promise<LiveBetResult> {
    return this.serial.run(async () => {
      assertUnexpired(request.expiresAt);
      const entry = this.journal.readForReconcile(request);
      if (entry?.result) return entry.result;
      if (entry?.state === "submit_started") {
        return unknown("Jun88 submit result is unresolved; bookmaker-history reconciliation is required");
      }
      return rejected("Jun88 bookmaker-history reconciliation is not implemented; no submit was performed");
    });
  }

  private finish(request: LiveCommitBetRequest, result: LiveBetResult) {
    this.journal.finish(request.idempotencyKey, result);
    return result;
  }
}

async function jun88SelectionIdentityMatches(page: Page, request: LivePrepareBetRequest) {
  for (const frame of page.frames()) {
    if (frame.isDetached()) continue;
    const result = await frame.evaluate(({ fixtureId, marketId, outcomeId, providerRef }) => {
      const state = (window as typeof window & {
        __surebet_cmd_stream__?: { byRow?: Record<string, Array<{
          fixtureId?: string;
          marketId?: string;
          outcomeId?: string;
          providerRef?: string;
          suspended?: boolean;
        }>> };
      }).__surebet_cmd_stream__;
      if (!state?.byRow) return false;
      return (state.byRow[fixtureId] ?? []).some((selection) =>
        selection.fixtureId === fixtureId && selection.marketId === marketId &&
        selection.outcomeId === outcomeId && selection.providerRef === providerRef &&
        selection.suspended !== true
      );
    }, request).catch(() => false);
    if (result) return true;
  }
  return false;
}

async function findJun88Odds(page: Page, providerRef: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      if (frame.isDetached()) continue;
      const candidates = frame.locator(JUN88_ODDS_SELECTOR);
      const count = await candidates.count().catch(() => 0);
      for (let index = 0; index < count; index += 1) {
        const locator = candidates.nth(index);
        const href = await locator.getAttribute("href").catch(() => "");
        if (extractJun88ProviderRef(href) !== providerRef) continue;
        if (!await locator.isVisible().catch(() => false)) continue;
        return { frame, locator };
      }
    }
    await page.waitForTimeout(100);
  }
  throw new Error(`Jun88 provider selection ${providerRef} is unavailable`);
}

async function findJun88Sidebar(page: Page, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      if (frame.isDetached()) continue;
      const locator = frame.locator(".PlaceBetLeft").first();
      if (await locator.isVisible().catch(() => false) &&
        await frame.locator("#tx_stake").first().isVisible().catch(() => false)) {
        return { frame, locator };
      }
    }
    await page.waitForTimeout(100);
  }
  throw new Error("Jun88 bet sidebar did not appear");
}

async function readJun88Slip(frame: Frame) {
  return {
    team: await text(frame.locator("#lb_bet_team")),
    handicap: await text(frame.locator("#lb_hdpball")),
    score: await text(frame.locator("#lb_hdpscore")),
    betType: await input(frame.locator("#tx_bet_type")),
    oddsType: await input(frame.locator("#tx_bet_oddsType")),
    rawOdds: parseDecimal(await input(frame.locator("#tx_bet_odds"))),
    minimumStake: parseDecimal(await input(frame.locator("#tx_min_bet"))),
    maximumStake: parseDecimal(await input(frame.locator("#tx_max_bet"))),
  };
}

async function readJun88BalanceVnd(page: Page) {
  for (const frame of page.frames()) {
    const balance = await readJun88CmdAccountBalance(frame);
    if (balance?.amountVnd !== undefined) return balance.amountVnd;
    for (const selector of ["#lb_credit", "#lblCredit", "#balance", ".balance", "[data-balance]"]) {
      const locator = frame.locator(selector).first();
      if (await locator.count().catch(() => 0) === 0) continue;
      const value = parseMoney(await text(locator, 250));
      if (value > 0) return value;
    }
  }
  return 0;
}

function validJun88ProviderRef(value: string) {
  return /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function extractJun88ProviderRef(href: string | null) {
  return String(href ?? "").match(/\bOddsClick\s*\(\s*this\s*,\s*['\"]([A-Za-z0-9_-]{1,128})['\"]\s*\)/i)?.[1] ?? "";
}

function publicPrepared(value: Jun88Prepared): LiveBetPrepared {
  const { request: _request, stakeUnitVnd: _stakeUnit, ...result } = value;
  return result;
}

function sameCorrelation(left: LivePrepareBetRequest, right: { actionId: string; opportunityId: string; legId: string }) {
  return left.actionId === right.actionId &&
    left.opportunityId === right.opportunityId && left.legId === right.legId;
}

async function text(locator: Locator, timeout = liveBetActionTimeoutMs()) {
  return (await locator.textContent({ timeout }).catch(() => ""))?.trim() ?? "";
}

async function input(locator: Locator) {
  return (await locator.inputValue({ timeout: liveBetActionTimeoutMs() }).catch(() => "")).trim();
}

function parseDecimal(value: string | null | undefined) {
  const parsed = Number.parseFloat(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseMoney(value: string) {
  const parsed = Number(String(value).replace(/[^0-9]/g, ""));
  return Number.isSafeInteger(parsed) ? parsed : 0;
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
