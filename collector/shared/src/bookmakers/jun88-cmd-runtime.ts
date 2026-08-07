import type { Frame, Page } from "playwright";
import type {
  CollectorSource,
  CollectContext,
  CollectorHeartbeat,
  CollectorSink,
  OddsDelta,
  OddsSelection,
  OddsSnapshot,
  QuoteConfirmationRequest
} from "../contracts.js";
import { formatError, writeDebugArtifacts } from "../core/debug.js";
import { envInt } from "../core/env.js";
import { JUN88_LOBBIES } from "./jun88-lobbies.js";
import { withJun88BookmakerPage } from "./jun88-bookmaker-page.js";
import { CMD_AVAILABILITY_CONFIG } from "./cmd-availability.js";
import { parseJun88CmdSnapshot } from "./parsers/jun88-cmd-parser.js";
import {
  buildDeltas,
  heartbeatIntervalMs,
  heartbeatOf,
  selectionMap
} from "./streaming-utils.js";

const CMD_READY_SELECTOR = ".match.default-match, .league.tableDiv-league-header";
const CMD_DELTA_BINDING = "__surebet_cmd_emit__";
const CMD_OBSERVATION_BINDING = "__surebet_cmd_observe__";

export class Jun88CmdRuntime {
  constructor(private readonly collectorId: string) {}

  async stream(context: CollectContext, sink: CollectorSink): Promise<void> {
    const lobby = requireLobbyConfig("cmd");
    return withJun88BookmakerPage(lobby, context.pageURL, async (page) => {
      try {
        let target = await resolveCmdContentTarget(page);
        await configureCmdUpstreamRefresh(target);
        console.log(
          `[jun88-cmd] timing reconcile_ms=${cmdReconcileIntervalMs()} ` +
          `bootstrap_settle_ms=${cmdSnapshotSettleMs("bootstrap")} ` +
          `live_poll_ms=${cmdLivePollIntervalMs()} ` +
          `today_poll_ms=${cmdTodayPollIntervalMs()} ` +
          `dom_scan_ms=${cmdDomScanIntervalMs()} ` +
          `observation_settle_ms=${cmdObserverObservationSettleMs()}`
        );

        // Phase B: extract only match table HTML instead of full page dump
        const initialRead = await readStableCmdSnapshot(target, this.collectorId, "bootstrap");
        if (!initialRead ||
          initialRead.observedSelections === 0 ||
          initialRead.snapshot.selections.length === 0) {
          throw new Error("Jun88 CMD initial page did not expose parseable market selections");
        }
        const initialSnapshot = initialRead.snapshot;
        let activeSnapshot: OddsSnapshot = {
          ...initialSnapshot,
          selections: []
        };
        let activeSnapshotMap = selectionMap(initialSnapshot);
        let streamFailure: Error | null = null;
        sink.setQuoteConfirmationHandler?.(async (request) => {
          let selection: OddsSelection | null;
          try {
            selection = await readCmdConfirmedSelection(target, request);
          } catch {
            target = await resolveCmdContentTarget(page);
            await configureCmdUpstreamRefresh(target);
            selection = await readCmdConfirmedSelection(target, request);
          }
          const observedAt = new Date().toISOString();
          return {
            observedAt,
            selection: selection
              ? {
                  ...selection,
                  sourceEventId: `cmd:${observedAt}`,
                  rawOdds: selection.odds,
                  oddsFormat: "malay"
                }
              : null
          };
        });
        await installCmdDeltaBinding(page, async (deltas) => {
          applyDeltasToSelectionMap(activeSnapshotMap, deltas);
          activeSnapshot = {
            ...activeSnapshot,
            collectedAt: latestDeltaTimestamp(deltas, activeSnapshot.collectedAt)
          };
          try {
            await sink.pushDelta(deltas);
          } catch (error) {
            streamFailure = error instanceof Error ? error : new Error(String(error));
            throw streamFailure;
          }
        });
        await installCmdObservationBinding(page, async (fixtureIds, observedAt) => {
          if (sink.observeFixtureMarketBatches) {
            await sink.observeFixtureMarketBatches(fixtureIds, observedAt);
            return;
          }
          for (const fixtureId of fixtureIds) {
            await sink.observeFixtureMarketBatch?.(fixtureId, observedAt);
          }
        });
        await installCmdObserver(target, initialSnapshot);
        await sink.pushBootstrap(initialSnapshot);
        await sink.heartbeat(heartbeatOf(initialSnapshot.source));
        let lastHeartbeatAt = Date.now();
        let lastReconcileAt = Date.now();
        let lastObserverHealthAt = Date.now();
        const heartbeatMs = heartbeatIntervalMs();

        while (!page.isClosed()) {
          if (streamFailure) {
            throw streamFailure;
          }

          if (Date.now() - lastObserverHealthAt >= cmdObserverHealthIntervalMs()) {
            if (!await isCmdObserverHealthy(target)) {
              target = await resolveCmdContentTarget(page);
              await configureCmdUpstreamRefresh(target);
              await installCmdObserver(target, {
                source: activeSnapshot.source,
                selections: []
              });
            }
            lastObserverHealthAt = Date.now();
          }

          if (Date.now() - lastReconcileAt >= cmdReconcileIntervalMs()) {
            await configureCmdUpstreamRefresh(target);
            const reconciledRead = await readStableCmdSnapshot(
              target,
              this.collectorId,
              "reconcile"
            );
            if (!reconciledRead || reconciledRead.snapshot.selections.length === 0) {
              lastReconcileAt = Date.now();
              continue;
            }
            const reconciledSnapshot = reconciledRead.snapshot;
            const reconciledFixtureIds = new Set(
              reconciledSnapshot.selections.map((selection) => selection.fixtureId)
            );
            const previousReconciledFixtures = new Map(
              Array.from(activeSnapshotMap).filter(([, selection]) =>
                reconciledFixtureIds.has(selection.fixtureId)
              )
            );
            const deltas = buildCmdReconcileDeltas(
              reconciledSnapshot,
              previousReconciledFixtures
            );
            activeSnapshot = {
              ...activeSnapshot,
              collectedAt: reconciledSnapshot.collectedAt,
              selections: []
            };
            if (deltas.length > 0) {
              await sink.pushDelta(deltas);
              applyDeltasToSelectionMap(activeSnapshotMap, deltas);
            }
            lastReconcileAt = Date.now();
            continue;
          }

          if (Date.now() - lastHeartbeatAt >= heartbeatMs) {
            await sink.heartbeat(heartbeatOf(activeSnapshot.source));
            lastHeartbeatAt = Date.now();
          }

          await page.waitForTimeout(cmdRuntimeLoopIntervalMs());
        }
      } catch (error) {
        await writeDebugArtifacts(page, `${this.collectorId}-stream-failed`);
        throw new Error(`[${this.collectorId}] stream failed: ${formatError(error)}`);
      } finally {
        sink.setQuoteConfirmationHandler?.(null);
      }
    });
  }
}

export async function configureCmdUpstreamRefresh(target: Page | Frame): Promise<void> {
  const liveSeconds = Math.ceil(cmdLivePollIntervalMs() / 1_000);
  const todaySeconds = Math.ceil(cmdTodayPollIntervalMs() / 1_000);
  const script = `
    (() => {
      const liveSeconds = ${liveSeconds};
      const todaySeconds = ${todaySeconds};
      const win = window;
      win.LiveSeconds = liveSeconds;
      win.TodayOrEarlySeconds = todaySeconds;

      for (const name of [
        "onLoadedIncRunningData",
        "onLoadedIncTodayData",
        "onLoadedIncEarlyData"
      ]) {
        const current = win[name];
        if (typeof current !== "function" || current.__surebetCmdUpstreamHook) {
          continue;
        }
        const wrapped = function(...args) {
          try {
            return current.apply(this, args);
          } finally {
            win.__surebet_cmd_upstream_tick__ =
              Number(win.__surebet_cmd_upstream_tick__ || 0) + 1;
            win.__surebet_cmd_upstream_tick_at__ = Date.now();
            win.__surebet_cmd_upstream_version__ = String(win.LastRunningVersion || "");
          }
        };
        wrapped.__surebetCmdUpstreamHook = true;
        win[name] = wrapped;
      }
      const afterRender = win.AfterRenderBetView;
      if (typeof afterRender === "function" && !afterRender.__surebetCmdRenderHook) {
        const wrappedAfterRender = function(...args) {
          try {
            return afterRender.apply(this, args);
          } finally {
            win.__surebet_cmd_render_at__ = Date.now();
            win.__surebet_cmd_render_tick__ =
              Number(win.__surebet_cmd_render_tick__ || 0) + 1;
          }
        };
        wrappedAfterRender.__surebetCmdRenderHook = true;
        win.AfterRenderBetView = wrappedAfterRender;
      }

      if (typeof win.ResetLiveTimerCounter === "function") {
        win.ResetLiveTimerCounter();
      } else {
        win.secondsLiveLeft = liveSeconds;
      }
      if (typeof win.ResetTodayLiveCounter === "function") {
        win.ResetTodayLiveCounter();
      } else {
        win.secondsTodayLeft = todaySeconds;
      }
    })()
  `;
  await target.evaluate(script);
}

async function isCmdObserverHealthy(target: Page | Frame) {
  return target.evaluate(() => {
    const state = (
      window as typeof window & {
        __surebet_cmd_stream__?: { observer?: MutationObserver; scanTimer?: number };
      }
    ).__surebet_cmd_stream__;
    return Boolean(state?.observer && state.scanTimer);
  }).catch(() => false);
}

async function readCmdConfirmedSelection(
  target: Page | Frame,
  request: QuoteConfirmationRequest
): Promise<OddsSelection | null> {
  return target.evaluate(({ fixtureId, marketId, outcomeId }) => {
    const state = (
      window as typeof window & {
        __surebet_cmd_stream__?: {
          byRow?: Record<string, OddsSelection[]>;
        };
      }
    ).__surebet_cmd_stream__;
    const rows = state?.byRow;
    if (!rows) {
      return null;
    }

    const rowStillExists = Array.from(
      document.querySelectorAll(".match.default-match, .match.copy-match")
    ).some((node) => (node.getAttribute("groupid") || node.id || "") === fixtureId);
    if (!rowStillExists) {
      return null;
    }

    const selection = (rows[fixtureId] ?? []).find(
      (item) =>
        item.fixtureId === fixtureId &&
        item.marketId === marketId &&
        item.outcomeId === outcomeId
    );

    return selection && !selection.suspended ? { ...selection } : null;
  }, request);
}

function requireLobbyConfig(lobbyId: "cmd") {
  const lobby = JUN88_LOBBIES.find((item) => item.lobbyId === lobbyId);
  if (!lobby) {
    throw new Error(`Jun88 ${lobbyId.toUpperCase()} lobby configuration is missing.`);
  }
  return lobby;
}

async function resolveCmdContentTarget(page: Page): Promise<Page | Frame> {
  await page.waitForSelector(`${CMD_READY_SELECTOR}, #contentIframe`, { timeout: 20_000 }).catch(() => undefined);

  const directMatch = await page.locator(CMD_READY_SELECTOR).count().catch(() => 0);
  if (directMatch > 0) {
    return page;
  }

  const iframeLocator = page.locator("#contentIframe").first();
  const iframeCount = await iframeLocator.count().catch(() => 0);
  if (iframeCount === 0) {
    throw new Error("Jun88 CMD page did not expose #contentIframe and no direct match rows were found.");
  }

  const iframe = await iframeLocator.elementHandle();
  const frame = await iframe?.contentFrame();
  if (frame) {
    await waitForFrameContent(frame).catch(() => undefined);
  }

  const frames = page.frames();
  for (const currentFrame of frames) {
    const count = await currentFrame.locator(CMD_READY_SELECTOR).count().catch(() => 0);
    if (count > 0) {
      return currentFrame;
    }
  }

  if (frame) {
    return frame;
  }

  const retryDirectMatch = await page.locator(CMD_READY_SELECTOR).count().catch(() => 0);
  if (retryDirectMatch > 0) {
    return page;
  }

  throw new Error("Jun88 CMD frame/page did not render match content in time.");
}

async function waitForFrameContent(frame: Frame) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 20_000) {
    if (await frame.locator(CMD_READY_SELECTOR).count()) {
      return;
    }

    await frame.page().waitForTimeout(250);
  }

  throw new Error("Jun88 CMD frame did not render match content in time.");
}

export async function installCmdObserver(
  target: Page | Frame,
  snapshot: {
    source: CollectorSource;
    selections: Array<{
      outcomeId: string;
      outcomeName: string;
      odds: number;
      suspended: boolean;
    }>;
  }
) {
  const seededFingerprints = Object.fromEntries(
    snapshot.selections.map((selection) => [
      selection.outcomeId,
      `${selection.odds}|${selection.outcomeName}|${selection.suspended}`
    ])
  );

  const script = `
    ((seededFingerprints, bindingName, observationBindingName, scanIntervalMs, observationSettleMs) => {
      const win = window;
      if (!win.__surebet_cmd_stream__) {
        win.__surebet_cmd_stream__ = {
          queue: [],
          seen: {},
          byRow: {},
          rowFingerprints: {},
          settleTimers: {},
          deltaInFlight: false,
          deltaRetryTimer: null,
          observationInFlight: false,
          lastMutationAt: Date.now()
        };
      }
      const state = win.__surebet_cmd_stream__;
      state.seen = Object.assign({}, seededFingerprints || {});
      state.rowFingerprints = {};
      state.observedUpstreamTick = Number(win.__surebet_cmd_upstream_tick__ || 0);
      state.observedUpstreamTickAt = Number(win.__surebet_cmd_upstream_tick_at__ || 0);
      state.lastMutationAt = Date.now();
      state.deltaInFlight = false;
      if (state.deltaRetryTimer) clearTimeout(state.deltaRetryTimer);
      state.deltaRetryTimer = null;
      state.observationInFlight = false;
      if (state.observer) state.observer.disconnect();
      if (state.scanTimer) clearInterval(state.scanTimer);
      for (const pending of Object.values(state.settleTimers || {})) {
        if (pending && pending.timer) clearTimeout(pending.timer);
      }
      state.settleTimers = {};

      const text = (node) => (node && node.textContent ? node.textContent.replace(/\\s+/g, " ").trim() : "");
      const normalizeToken = (value) =>
        value.normalize("NFKD").replace(/[^\\p{L}\\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").toLowerCase();
      const parseOdds = (value) => Number.parseFloat((value || "").replace(/[^\\d./-]+/g, ""));
      const installUpstreamHooks = () => {
        for (const name of [
          "onLoadedIncRunningData",
          "onLoadedIncTodayData",
          "onLoadedIncEarlyData"
        ]) {
          const current = win[name];
          if (typeof current !== "function" || current.__surebetCmdUpstreamHook) {
            continue;
          }
          const wrapped = function(...args) {
            try {
              return current.apply(this, args);
            } finally {
              win.__surebet_cmd_upstream_tick__ =
                Number(win.__surebet_cmd_upstream_tick__ || 0) + 1;
              win.__surebet_cmd_upstream_tick_at__ = Date.now();
              win.__surebet_cmd_upstream_version__ = String(win.LastRunningVersion || "");
            }
          };
          wrapped.__surebetCmdUpstreamHook = true;
          win[name] = wrapped;
        }
        const afterRender = win.AfterRenderBetView;
        if (typeof afterRender === "function" && !afterRender.__surebetCmdRenderHook) {
          const wrappedAfterRender = function(...args) {
            try {
              return afterRender.apply(this, args);
            } finally {
              win.__surebet_cmd_render_at__ = Date.now();
              win.__surebet_cmd_render_tick__ =
                Number(win.__surebet_cmd_render_tick__ || 0) + 1;
            }
          };
          wrappedAfterRender.__surebetCmdRenderHook = true;
          win.AfterRenderBetView = wrappedAfterRender;
        }
      };
      installUpstreamHooks();
      const availability = ${JSON.stringify(CMD_AVAILABILITY_CONFIG)};
      const unavailableClassPattern = new RegExp(availability.unavailableClassPatternSource, "i");
      const unavailableStylePattern = new RegExp(availability.unavailableStylePatternSource, "i");
      const unavailableStatePattern = new RegExp(availability.unavailableStatePatternSource, "i");
      const isUnavailable = (node) => {
        if (!node) return true;
        let current = node;
        while (current) {
          if (
            current.hasAttribute("disabled") ||
            current.hasAttribute("hidden") ||
            current.getAttribute("aria-disabled") === "true" ||
            current.getAttribute("aria-hidden") === "true" ||
            current.getAttribute("data-active") === "false" ||
            current.getAttribute("data-enabled") === "false" ||
            unavailableClassPattern.test(String(current.className || "")) ||
            unavailableStylePattern.test(current.getAttribute("style") || "") ||
            unavailableStatePattern.test(current.getAttribute("data-status") || "") ||
            unavailableStatePattern.test(current.getAttribute("data-state") || "")
          ) return true;
          if (current.matches(availability.boundarySelector)) break;
          current = current.parentElement;
        }
        return false;
      };
      const quoteId = (fixtureId, marketId, outcomeName) => fixtureId + ":" + marketId + ":" + normalizeToken(outcomeName);
      const normalizeHandicapLine = (line, side, givingSide) => {
        if (!line) return "";
        const absoluteLine = line.replace(/^[+-]/, "");
        return side === givingSide ? "-" + absoluteLine : "+" + absoluteLine;
      };
      const handicapGivingSide = (lineNode) => {
        const breakNode = lineNode && lineNode.querySelector("br");
        if (!breakNode) return "home";
        let sibling = breakNode.nextSibling;
        while (sibling) {
          if (text(sibling)) return "away";
          sibling = sibling.nextSibling;
        }
        return "home";
      };
      const selectionButton = (buttons, marker, fallbackIndex) =>
        buttons.find((button) => String(button.getAttribute("href") || "").includes(marker)) ||
        buttons[fallbackIndex];
      const formatOutcome = (name, line) => [name, line].filter(Boolean).join(" ").trim();
      const marketIdOf = (prefix, kind) => {
        const isFirstHalf = String(prefix || "").trim().toUpperCase() === "1H";
        if (kind === "handicap") return isFirstHalf ? "hdp-ah-1st" : "hdp-ah";
        if (kind === "over_under") return isFirstHalf ? "o-u-ou-1st" : "o-u-ou";
        if (kind === "one_x_two") return isFirstHalf ? "1x2-1st" : "1x2";
        return normalizeToken(prefix + "-" + kind);
      };
      const filterFixtureText = (value) =>
        String(value || "")
          .normalize("NFKD")
          .replace(/[\\u0300-\\u036f]/g, "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, " ")
          .replace(/\\s+/g, " ")
          .trim();
      const isStandardFixture = (leagueName, homeTeam, awayTeam) => {
        if (!String(homeTeam || "").trim() || !String(awayTeam || "").trim()) return false;
        const league = filterFixtureText(leagueName);
        const participants = filterFixtureText(homeTeam + " " + awayTeam);
        return !(
          /\\b(corners?|corner kicks?|bookings?|cards?|e\\s?soccer|e\\s?football|exotic|specials?|virtual)\\b/.test(league) ||
          /\\bsingle team\\b/.test(league) ||
          /\\bspecific\\s+\\d+\\s+mins?\\b/.test(league) ||
          /\\b(no of corners?|\\d+(st|nd|rd|th) corner|\\d{1,2}\\s+\\d{2}\\s+\\d{1,2}\\s+\\d{2})\\b/.test(participants) ||
          /\\b(over|under)\\s*$/.test(filterFixtureText(homeTeam)) ||
          /\\b(over|under)\\s*$/.test(filterFixtureText(awayTeam))
        );
      };

      const selection = (node, fixtureId, homeTeam, awayTeam, leagueName, marketId, outcomeName) => {
        if (!node) return null;
        const odds = parseOdds(text(node));
        const hasOdds = Number.isFinite(odds);
        return {
          fixtureId,
          sport: "football",
          homeTeam,
          awayTeam,
          leagueName,
          matchState: "live",
          marketId,
          outcomeId: quoteId(fixtureId, marketId, outcomeName),
          outcomeName,
          odds: hasOdds ? odds : 0,
          rawOdds: hasOdds ? odds : 0,
          oddsFormat: "malay",
          availableStake: 0,
          suspended: !hasOdds || isUnavailable(node)
        };
      };

      const precedingLeagueLabel = (matchNode) => {
        const scope = matchNode.closest(".tableDiv");
        if (!scope) return null;
        const entries = Array.from(scope.querySelectorAll(".league label, .match.default-match"));
        const matchIndex = entries.indexOf(matchNode);
        for (let index = matchIndex - 1; index >= 0; index -= 1) {
          if (entries[index].matches(".league label")) return entries[index];
        }
        return null;
      };

      const parseMatchGroup = (groupId) => {
        const rows = Array.from(document.querySelectorAll(".match.default-match, .match.copy-match"))
          .filter((node) => (node.getAttribute("groupid") || node.id || "") === groupId);
        const baseRow = rows.find((node) => node.classList.contains("default-match")) || rows[0];
        if (!baseRow) return [];

        const matchID = (baseRow.id || "").replace(/^R_/, "");
        const leagueName = text(precedingLeagueLabel(baseRow));
        const homeTeam = text(baseRow.querySelector("#ht_" + matchID)) || text(baseRow.querySelector(".tableDiv-match-info__event div:first-child"));
        const awayTeam = text(baseRow.querySelector("#at_" + matchID)) || text(baseRow.querySelector(".tableDiv-match-info__event div:nth-child(2)"));
        const drawLabel = text(baseRow.querySelector(".drawcss")) || "Hòa";
        if (!isStandardFixture(leagueName, homeTeam, awayTeam)) return [];
        const fixtureId = baseRow.getAttribute("groupid") || [leagueName, homeTeam, awayTeam, matchID].filter(Boolean).join("|");

        const parseMarketRow = (rowNode, prefix) => {
          if (!rowNode) return [];
          const selections = [];

          for (const hdpNode of Array.from(rowNode.querySelectorAll(".w-hdp .tableDiv-match-odds"))) {
            const lineNode = hdpNode.querySelector("b");
            const line = text(lineNode);
            const givingSide = handicapGivingSide(lineNode);
            const buttons = Array.from(hdpNode.querySelectorAll(".tableDiv-match-odds__detail > a"));
            const marketId = marketIdOf(prefix, "handicap");
            const homeLine = normalizeHandicapLine(line, "home", givingSide);
            const awayLine = normalizeHandicapLine(line, "away", givingSide);
            const home = selection(selectionButton(buttons, "Hdp_Home", 0), fixtureId, homeTeam, awayTeam, leagueName, marketId, formatOutcome(homeTeam, homeLine));
            const away = selection(selectionButton(buttons, "Hdp_Away", 1), fixtureId, homeTeam, awayTeam, leagueName, marketId, formatOutcome(awayTeam, awayLine));
            if (home) selections.push(home);
            if (away) selections.push(away);
          }

          for (const ouNode of Array.from(rowNode.querySelectorAll(".w-ou .tableDiv-match-odds"))) {
            const line = text(ouNode.querySelector("b"));
            const buttons = Array.from(ouNode.querySelectorAll(".tableDiv-match-odds__detail a"));
            const marketId = marketIdOf(prefix, "over_under");
            const over = selection(buttons[0], fixtureId, homeTeam, awayTeam, leagueName, marketId, formatOutcome("Over", line));
            const under = selection(buttons[1], fixtureId, homeTeam, awayTeam, leagueName, marketId, formatOutcome("Under", line));
            if (over) selections.push(over);
            if (under) selections.push(under);
          }

          for (const x12Node of Array.from(rowNode.querySelectorAll(".col-45 .tableDiv-match-odds__X12detail"))) {
            const buttons = Array.from(x12Node.querySelectorAll("a"));
            const marketId = marketIdOf(prefix, "one_x_two");
            const home = selection(buttons[0], fixtureId, homeTeam, awayTeam, leagueName, marketId, homeTeam);
            const away = selection(buttons[1], fixtureId, homeTeam, awayTeam, leagueName, marketId, awayTeam);
            const draw = selection(buttons[2], fixtureId, homeTeam, awayTeam, leagueName, marketId, drawLabel);
            if (home) selections.push(home);
            if (away) selections.push(away);
            if (draw) selections.push(draw);
          }

          return selections;
        };

        const selections = [];
        const seenOutcomeIds = new Set();
        for (const rowNode of rows) {
          const fullTimeRows = Array.from(rowNode.querySelectorAll(":scope > .col.row:not(.halfmatchStats)"));
          const halfTimeRows = Array.from(rowNode.querySelectorAll(":scope > .col.row.halfmatchStats"));
          for (const item of [
            ...fullTimeRows.flatMap((currentRow) => parseMarketRow(currentRow, "FT")),
            ...halfTimeRows.flatMap((currentRow) => parseMarketRow(currentRow, "1H"))
          ]) {
            if (seenOutcomeIds.has(item.outcomeId)) continue;
            seenOutcomeIds.add(item.outcomeId);
            selections.push(item);
          }
        }

        return selections;
      };

      const syncRow = (rowNode, emit) => {
        const rowKey = rowNode.getAttribute("groupid") || rowNode.id || "";
        if (!rowKey) return;
        const groupRows = Array.from(document.querySelectorAll(".match.default-match, .match.copy-match"))
          .filter((node) => (node.getAttribute("groupid") || node.id || "") === rowKey);
        const rowFingerprint = fingerprintRows(groupRows);
        if (emit && state.rowFingerprints[rowKey] === rowFingerprint) return;
        state.rowFingerprints[rowKey] = rowFingerprint;
        const current = parseMatchGroup(rowKey);
        const previous = state.byRow[rowKey] || [];
        const currentMap = Object.fromEntries(current.map((item) => [item.outcomeId, item]));

        if (emit) {
          const observedAt = new Date().toISOString();
          const providerVersion = String(win.LastRunningVersion || "").trim();
          const upstreamTick = Number(win.__surebet_cmd_upstream_tick__ || 0);
          const sourceEventId = providerVersion
            ? "cmd:" + providerVersion + ":" + upstreamTick
            : "cmd:local:" + observedAt;
          const changed = current.some((item) => {
            const fingerprint = item.odds + "|" + item.outcomeName + "|" + item.suspended;
            return state.seen[item.outcomeId] !== fingerprint;
          }) || previous.some((item) => !currentMap[item.outcomeId]);

          if (changed) {
            // A stable CMD row is the atomic observation unit. Re-send every
            // outcome in the fixture so v1 consumers never receive one new leg
            // paired with an older sibling.
            for (const item of current) {
              state.seen[item.outcomeId] =
                item.odds + "|" + item.outcomeName + "|" + item.suspended;
              state.queue.push({
                source: { collectorId: "jun88-cmd", bookmakerId: "jun88", lobbyId: "cmd" },
                collectedAt: observedAt,
                fixtureId: item.fixtureId,
                sport: item.sport,
                homeTeam: item.homeTeam,
                awayTeam: item.awayTeam,
                leagueName: item.leagueName,
                matchState: item.matchState,
                marketId: item.marketId,
                outcomeId: item.outcomeId,
                outcomeName: item.outcomeName,
                odds: item.odds,
                availableStake: item.availableStake,
                suspended: item.suspended,
                sourceEventId,
                rawOdds: item.rawOdds,
                oddsFormat: item.oddsFormat,
                op: "upsert"
              });
            }

            for (const item of previous) {
              if (!currentMap[item.outcomeId]) {
                delete state.seen[item.outcomeId];
                state.queue.push({
                  source: { collectorId: "jun88-cmd", bookmakerId: "jun88", lobbyId: "cmd" },
                  collectedAt: observedAt,
                  fixtureId: item.fixtureId,
                  sport: item.sport,
                  homeTeam: item.homeTeam,
                  awayTeam: item.awayTeam,
                  leagueName: item.leagueName,
                  matchState: item.matchState,
                  marketId: item.marketId,
                  outcomeId: item.outcomeId,
                  outcomeName: item.outcomeName,
                  odds: item.odds,
                  availableStake: item.availableStake,
                  suspended: true,
                  sourceEventId,
                  rawOdds: item.rawOdds,
                  oddsFormat: item.oddsFormat,
                  op: "remove"
                });
              }
            }
          }
        }

        state.byRow[rowKey] = current;
      };

      const fingerprintRows = (rows) => rows.map((row) => {
        const trackedNodes = [
          row,
          ...Array.from(row.querySelectorAll(
            ".w-hdp, .w-ou, .tableDiv-match-odds, .tableDiv-match-odds__detail, a, button, input"
          ))
        ];
        const attributes = trackedNodes.map((node) => [
          node.className || "",
          node.getAttribute("aria-disabled") || "",
          node.getAttribute("aria-hidden") || "",
          node.getAttribute("disabled") || "",
          node.getAttribute("hidden") || "",
          node.getAttribute("style") || "",
          node.getAttribute("data-status") || "",
          node.getAttribute("data-state") || "",
          node.getAttribute("data-active") || "",
          node.getAttribute("data-enabled") || "",
          node.getAttribute("data-odds") || "",
          node.getAttribute("data-value") || "",
          node.getAttribute("value") || ""
        ].join("|")).join(";");
        return text(row) + "|" + attributes;
      }).join("\\u0001");

      const emitQueue = () => {
        if (
          state.queue.length === 0 ||
          state.deltaInFlight ||
          state.deltaRetryTimer ||
          typeof win[bindingName] !== "function"
        ) return;
        const batch = state.queue.splice(0, state.queue.length);
        state.deltaInFlight = true;
        let failed = false;
        Promise.resolve()
          .then(() => win[bindingName](batch))
          .catch(() => {
            failed = true;
            state.queue.unshift(...batch);
          })
          .finally(() => {
            state.deltaInFlight = false;
            if (state.queue.length > 0) {
              if (failed) {
                state.deltaRetryTimer = setTimeout(() => {
                  state.deltaRetryTimer = null;
                  emitQueue();
                }, 250);
              } else {
                emitQueue();
              }
            }
          });
      };

      const scheduleStableRow = (rowKey) => {
        if (!rowKey || state.settleTimers[rowKey]) return;
        const pending = { startedAt: Date.now(), timer: null };
        state.settleTimers[rowKey] = pending;
        const attempt = () => {
          const firstRows = Array.from(document.querySelectorAll(".match.default-match, .match.copy-match"))
            .filter((node) => (node.getAttribute("groupid") || node.id || "") === rowKey);
          const firstFingerprint = fingerprintRows(firstRows);
          pending.timer = setTimeout(() => {
            const secondRows = Array.from(document.querySelectorAll(".match.default-match, .match.copy-match"))
              .filter((node) => (node.getAttribute("groupid") || node.id || "") === rowKey);
            const secondFingerprint = fingerprintRows(secondRows);
            if (firstFingerprint === secondFingerprint) {
              delete state.settleTimers[rowKey];
              if (secondRows.length > 0) {
                syncRow(secondRows[0], true);
              } else {
                const previous = state.byRow[rowKey] || [];
                for (const item of previous) {
                  delete state.seen[item.outcomeId];
                  state.queue.push({
                    source: { collectorId: "jun88-cmd", bookmakerId: "jun88", lobbyId: "cmd" },
                    collectedAt: new Date().toISOString(),
                    fixtureId: item.fixtureId,
                    sport: item.sport,
                    homeTeam: item.homeTeam,
                    awayTeam: item.awayTeam,
                    leagueName: item.leagueName,
                    matchState: item.matchState,
                    marketId: item.marketId,
                    outcomeId: item.outcomeId,
                    outcomeName: item.outcomeName,
                    odds: item.odds,
                    availableStake: item.availableStake,
                    suspended: true,
                    sourceEventId: "cmd:" + new Date().toISOString(),
                    rawOdds: item.rawOdds,
                    oddsFormat: item.oddsFormat,
                    op: "remove"
                  });
                }
                delete state.byRow[rowKey];
                delete state.rowFingerprints[rowKey];
              }
              emitQueue();
              return;
            }
            if (Date.now() - pending.startedAt >= 500) {
              delete state.settleTimers[rowKey];
              return;
            }
            pending.timer = setTimeout(attempt, 0);
          }, 50);
        };
        pending.timer = setTimeout(attempt, 100);
      };

      const initializedRowKeys = new Set();
      const seededOutcomeIds = new Set(Object.keys(seededFingerprints || {}));
      for (const rowNode of Array.from(document.querySelectorAll(".match.default-match, .match.copy-match"))) {
        const rowKey = rowNode.getAttribute("groupid") || rowNode.id || "";
        if (!rowKey || initializedRowKeys.has(rowKey)) continue;
        initializedRowKeys.add(rowKey);
        const current = parseMatchGroup(rowKey);
        if (current.some((item) => seededOutcomeIds.has(item.outcomeId))) {
          syncRow(rowNode, false);
          continue;
        }
        state.byRow[rowKey] = [];
        scheduleStableRow(rowKey);
      }

      const observer = new MutationObserver((mutations) => {
        const rows = new Set();
        const removedRows = [];
        for (const mutation of mutations) {
          const target = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
          const row = target && target.closest ? target.closest(".match.default-match, .match.copy-match") : null;
          if (row) rows.add(row);
          for (const added of Array.from(mutation.addedNodes || [])) {
            if (added instanceof Element) {
              if (added.matches(".match.default-match, .match.copy-match")) rows.add(added);
              for (const nested of Array.from(added.querySelectorAll?.(".match.default-match, .match.copy-match") || [])) rows.add(nested);
            }
          }
          for (const removed of Array.from(mutation.removedNodes || [])) {
            if (removed instanceof Element) {
              if (removed.matches(".match.default-match, .match.copy-match")) removedRows.push(removed);
              for (const nested of Array.from(removed.querySelectorAll?.(".match.default-match, .match.copy-match") || [])) removedRows.push(nested);
            }
          }
        }
        if (rows.size > 0 || removedRows.length > 0) {
          state.lastMutationAt = Date.now();
        }
        for (const row of removedRows) scheduleStableRow(row.getAttribute("groupid") || row.id || "");
        for (const row of rows) scheduleStableRow(row.getAttribute("groupid") || row.id || "");
      });

      observer.observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: [
          "class", "disabled", "hidden", "aria-disabled", "aria-hidden", "style",
          "data-status", "data-state", "data-active", "data-enabled",
          "value", "data-odds", "data-value"
        ]
      });
      state.observer = observer;

      state.scanTimer = setInterval(() => {
        installUpstreamHooks();
        const rows = Array.from(document.querySelectorAll(".match.default-match, .match.copy-match"));
        const groupedRows = new Map();
        for (const row of rows) {
          const rowKey = row.getAttribute("groupid") || row.id || "";
          if (!rowKey) continue;
          const groupRows = groupedRows.get(rowKey) || [];
          groupRows.push(row);
          groupedRows.set(rowKey, groupRows);
        }
        const upstreamTick = Number(win.__surebet_cmd_upstream_tick__ || 0);
        const hasNewUpstreamResponse = upstreamTick > Number(state.observedUpstreamTick || 0);
        for (const [rowKey, groupRows] of groupedRows) {
          const fingerprint = fingerprintRows(groupRows);
          if (state.rowFingerprints[rowKey] !== fingerprint) {
            scheduleStableRow(rowKey);
          }
        }

        for (const rowKey of Object.keys(state.byRow)) {
          if (!groupedRows.has(rowKey)) scheduleStableRow(rowKey);
        }

        const now = Date.now();
        const upstreamTickAt = Number(win.__surebet_cmd_upstream_tick_at__ || 0);
        const renderAt = Number(win.__surebet_cmd_render_at__ || 0);
        const quietSince = Math.max(state.lastMutationAt || 0, upstreamTickAt || 0, renderAt || 0);
        const renderSettled = hasNewUpstreamResponse &&
          now - quietSince >= observationSettleMs;
        if (renderSettled &&
          Object.keys(state.settleTimers).length === 0 &&
          state.queue.length === 0 &&
          !state.deltaInFlight &&
          !state.observationInFlight &&
          typeof win[observationBindingName] === "function") {
          const fixtureIds = Array.from(groupedRows.keys())
            .map((rowKey) => state.byRow[rowKey]?.[0]?.fixtureId || "")
            .filter(Boolean);
          const previousTick = Number(state.observedUpstreamTick || 0);
          state.observedUpstreamTick = upstreamTick;
          state.observedUpstreamTickAt = upstreamTickAt;
          state.observationInFlight = true;
          Promise.resolve()
            .then(() => win[observationBindingName]({
              fixtureIds: Array.from(new Set(fixtureIds)),
              observedAt: new Date().toISOString(),
              providerVersion: String(win.LastRunningVersion || "")
            }))
            .catch(() => {
              if (Number(state.observedUpstreamTick || 0) === upstreamTick) {
                state.observedUpstreamTick = previousTick;
              }
            })
            .finally(() => {
              state.observationInFlight = false;
            });
        }
      }, scanIntervalMs);
    })
  `;

  await target.evaluate(
    `${script}(${JSON.stringify(seededFingerprints)}, ${JSON.stringify(CMD_DELTA_BINDING)}, ${JSON.stringify(CMD_OBSERVATION_BINDING)}, ${cmdDomScanIntervalMs()}, ${cmdObserverObservationSettleMs()})`
  );
}

/**
 * Phase B: Extract only the match table HTML that parseJun88CmdSnapshot needs.
 * Avoids serialising the full page (~500KB+) via target.content() and sending
 * it back over CDP. The parser only uses .tableDiv rows so we grab those containers.
 */
async function extractCmdMatchHtml(target: Page | Frame): Promise<string> {
  const partial = await target.evaluate(() => {
    const containers = Array.from(document.querySelectorAll(".tableDiv"));
    if (containers.length > 0) {
      return `<div class="surebet-partial">${containers.map((el) => el.outerHTML).join("")}</div>`;
    }
    // fallback: whole body (triggers parseFallbackMatches in the parser)
    return document.body?.outerHTML ?? "";
  });
  return partial;
}

type CmdDomFingerprint = Record<string, string>;

/**
 * Fingerprint only fields which affect parsed selections. Live match clocks and
 * score counters are intentionally excluded because they change continuously
 * without changing the odds snapshot.
 */
async function readCmdDomFingerprint(target: Page | Frame): Promise<CmdDomFingerprint> {
  const script = `
    (() => {
      const text = (node) => node && node.textContent
        ? node.textContent.replace(/\\s+/g, " ").trim()
        : "";
      const attributes = (node) => [
        node.id || "",
        node.className || "",
        node.getAttribute("href") || "",
        node.getAttribute("title") || "",
        node.getAttribute("name") || "",
        node.getAttribute("aria-disabled") || "",
        node.getAttribute("aria-hidden") || "",
        node.getAttribute("disabled") || "",
        node.getAttribute("hidden") || "",
        node.getAttribute("style") || "",
        node.getAttribute("data-status") || "",
        node.getAttribute("data-state") || "",
        node.getAttribute("data-active") || "",
        node.getAttribute("data-enabled") || "",
        node.getAttribute("data-odds") || "",
        node.getAttribute("data-value") || "",
        node.getAttribute("value") || ""
      ].join("|");
      const marketSelector = [
        ".w-hdp .tableDiv-match-odds",
        ".w-ou .tableDiv-match-odds",
        ".col-45 .tableDiv-match-odds__X12detail"
      ].join(", ");
      const rows = Array.from(
        document.querySelectorAll(".match.default-match, .match.copy-match")
      );
      const grouped = new Map();
      for (const row of rows) {
        const rowKey = row.getAttribute("groupid") || row.id || "";
        if (!rowKey) continue;
        const matchId = (row.id || "").replace(/^R_/, "");
        const teamAndIdentity = [
          rowKey,
          row.id || "",
          row.getAttribute("leagueid") || "",
          attributes(row),
          text(row.querySelector("#ht_" + matchId)),
          text(row.querySelector("#at_" + matchId)),
          text(row.querySelector(".drawcss"))
        ].join("|");
        const marketValues = Array.from(row.querySelectorAll(marketSelector)).map((node) => {
          const controls = Array.from(node.querySelectorAll("a, button, input")).map((control) => [
            text(control),
            attributes(control)
          ].join("|")).join(";");
          const ancestors = [node.parentElement, node.parentElement && node.parentElement.parentElement]
            .filter(Boolean)
            .map((ancestor) => attributes(ancestor))
            .join(";");
          return [text(node), attributes(node), ancestors, controls].join("|");
        });
        const rowFingerprint = [teamAndIdentity, ...marketValues].join("\\u0002");
        const current = grouped.get(rowKey) || [];
        current.push(rowFingerprint);
        grouped.set(rowKey, current);
      }
      if (grouped.size === 0) {
        const fallback = Array.from(document.querySelectorAll("a.odds, [data-odds], [data-value]"))
          .map((node) => [text(node), attributes(node)].join("|"))
          .join("\\u0001");
        if (fallback) grouped.set("__fallback__", [fallback]);
      }
      return Object.fromEntries(
        Array.from(grouped.entries())
          .map(([rowKey, values]) => [rowKey, values.sort().join("\\u0001")])
          .sort(([left], [right]) => left.localeCompare(right))
      );
    })()
  `;
  return await target.evaluate(script) as CmdDomFingerprint;
}

export type StableCmdSnapshotRead = {
  snapshot: OddsSnapshot;
  observedFixtures: number;
  observedSelections: number;
  stableFixtures: number;
  attempts: number;
};

export async function readStableCmdSnapshot(
  target: Page | Frame,
  collectorId: string,
  mode: "bootstrap" | "reconcile"
): Promise<StableCmdSnapshotRead | null> {
  const readStartedAt = Date.now();
  let attempts = 0;
  let previousFingerprint = await readCmdDomFingerprint(target);
  let previous = parseJun88CmdSnapshot(
    await extractCmdMatchHtml(target),
    target.url(),
    collectorId
  );
  const settleStartedAt = Date.now();
  do {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
    attempts += 1;
    const currentFingerprint = await readCmdDomFingerprint(target);
    if (equalCmdDomFingerprints(previousFingerprint, currentFingerprint)) {
      if (previous.selections.length === 0) {
        continue;
      }
      const result = stableCmdSnapshotRead(previous, previous, attempts);
      logStableCmdSnapshot(mode, result, Date.now() - readStartedAt);
      return result;
    }
    const current = parseJun88CmdSnapshot(
      await extractCmdMatchHtml(target),
      target.url(),
      collectorId
    );
    const stable = selectStableCmdSnapshotFixtures(previous, current);
    if (mode === "bootstrap" && stable.selections.length > 0) {
      const result = stableCmdSnapshotRead(stable, current, attempts);
      logStableCmdSnapshot(mode, result, Date.now() - readStartedAt);
      return result;
    }
    previous = current;
    previousFingerprint = currentFingerprint;
  } while (Date.now() - settleStartedAt < cmdSnapshotSettleMs(mode));

  if (previous.selections.length === 0) {
    console.warn(
      `[jun88-cmd] snapshot mode=${mode} has no parseable selections after ` +
      `${cmdSnapshotSettleMs(mode)}ms`
    );
    return null;
  }
  if (mode === "bootstrap") {
    console.warn(
      `[jun88-cmd] bootstrap snapshot remained active during ` +
      `${cmdSnapshotSettleMs(mode)}ms; using the latest parsed state`
    );
    const result = stableCmdSnapshotRead(previous, previous, attempts);
    logStableCmdSnapshot(mode, result, Date.now() - readStartedAt);
    return result;
  }
  const emptySnapshot = { ...previous, selections: [] };
  const result = stableCmdSnapshotRead(emptySnapshot, previous, attempts);
  logStableCmdSnapshot(mode, result, Date.now() - readStartedAt);
  return result;
}

function equalCmdDomFingerprints(
  previous: CmdDomFingerprint,
  current: CmdDomFingerprint
) {
  const previousKeys = Object.keys(previous);
  const currentKeys = Object.keys(current);
  if (previousKeys.length !== currentKeys.length) {
    return false;
  }
  return previousKeys.every((key) => previous[key] === current[key]);
}

export function selectStableCmdSnapshotFixtures(
  previous: OddsSnapshot,
  current: OddsSnapshot
): OddsSnapshot {
  const previousByFixture = selectionsByFixture(previous.selections);
  const currentByFixture = selectionsByFixture(current.selections);
  const stableSelections: OddsSelection[] = [];
  for (const [fixtureId, selections] of currentByFixture) {
    const previousSelections = previousByFixture.get(fixtureId);
    if (!previousSelections ||
      cmdFixtureFingerprint(previousSelections) !== cmdFixtureFingerprint(selections)) {
      continue;
    }
    stableSelections.push(...selections);
  }
  return { ...current, selections: stableSelections };
}

/**
 * Reconciliation is a recovery path, so an affected fixture is sent as a
 * complete atomic batch. This repairs a price which the DOM observer missed
 * and keeps v1 consumers from seeing only one side of a market.
 */
export function buildCmdReconcileDeltas(
  snapshot: OddsSnapshot,
  previous: Map<string, OddsSelection>
) {
  const next = selectionMap(snapshot);
  const changed = buildDeltas(snapshot, previous, next);
  if (changed.length === 0) {
    return [];
  }

  const affectedFixtures = new Set(changed.map((delta) => delta.fixtureId));
  const completeUpserts = buildDeltas(
    snapshot,
    new Map<string, OddsSelection>(),
    new Map(
      Array.from(next).filter(([, selection]) => affectedFixtures.has(selection.fixtureId))
    )
  ).filter((delta) => delta.op === "upsert");
  const removals = changed.filter((delta) => delta.op === "remove");
  const byOutcome = new Map<string, OddsDelta>();
  for (const delta of [...completeUpserts, ...removals]) {
    byOutcome.set(`${delta.op}:${delta.outcomeId}`, delta);
  }
  return Array.from(byOutcome.values());
}

function selectionsByFixture(selections: OddsSelection[]) {
  const result = new Map<string, OddsSelection[]>();
  for (const selection of selections) {
    const fixtureSelections = result.get(selection.fixtureId) ?? [];
    fixtureSelections.push(selection);
    result.set(selection.fixtureId, fixtureSelections);
  }
  return result;
}

function cmdFixtureFingerprint(selections: OddsSelection[]) {
  return selections
    .map((selection) => [
      selection.outcomeId,
      selection.outcomeName,
      selection.odds,
      selection.suspended
    ].join("\u0000"))
    .sort()
    .join("\u0001");
}

function stableCmdSnapshotRead(
  snapshot: OddsSnapshot,
  observed: OddsSnapshot,
  attempts: number
): StableCmdSnapshotRead {
  return {
    snapshot,
    observedFixtures: selectionsByFixture(observed.selections).size,
    observedSelections: observed.selections.length,
    stableFixtures: selectionsByFixture(snapshot.selections).size,
    attempts
  };
}

function logStableCmdSnapshot(
  mode: "bootstrap" | "reconcile",
  result: StableCmdSnapshotRead,
  elapsedMs: number
) {
  console.log(
    `[jun88-cmd] snapshot mode=${mode} ` +
    `fixtures=${result.stableFixtures}/${result.observedFixtures} ` +
    `selections=${result.snapshot.selections.length}/${result.observedSelections} ` +
    `attempts=${result.attempts} elapsed_ms=${elapsedMs}`
  );
}

async function installCmdDeltaBinding(
  page: Page,
  onDeltas: (deltas: OddsDelta[]) => Promise<void>
) {
  await page.exposeBinding(CMD_DELTA_BINDING, async (_source, value: unknown) => {
    if (!Array.isArray(value) || value.length === 0) {
      return;
    }
    await onDeltas(value as OddsDelta[]);
  });
}

async function installCmdObservationBinding(
  page: Page,
  onObservation: (fixtureIds: string[], observedAt: string) => Promise<void>
) {
  await page.exposeBinding(CMD_OBSERVATION_BINDING, async (_source, value: unknown) => {
    if (!value || typeof value !== "object") {
      return;
    }
    const observation = value as { fixtureIds?: unknown; observedAt?: unknown };
    if (!Array.isArray(observation.fixtureIds) ||
      typeof observation.observedAt !== "string") {
      return;
    }
    const fixtureIds = Array.from(new Set(
      observation.fixtureIds.filter((fixtureId): fixtureId is string =>
        typeof fixtureId === "string" && fixtureId.trim() !== ""
      )
    ));
    if (fixtureIds.length > 0) {
      await onObservation(fixtureIds, observation.observedAt);
    }
  });
}

function applyDeltasToSelectionMap(
  current: Map<string, OddsSnapshot["selections"][number]>,
  deltas: OddsDelta[]
) {
  for (const delta of deltas) {
    if (delta.op === "remove") {
      current.delete(delta.outcomeId);
      continue;
    }
    current.set(delta.outcomeId, {
      fixtureId: delta.fixtureId,
      sport: delta.sport,
      homeTeam: delta.homeTeam,
      awayTeam: delta.awayTeam,
      leagueName: delta.leagueName,
      matchState: delta.matchState,
      eventStartAt: delta.eventStartAt,
      marketId: delta.marketId,
      outcomeId: delta.outcomeId,
      outcomeName: delta.outcomeName,
      odds: delta.odds,
      rawOdds: delta.rawOdds,
      oddsFormat: delta.oddsFormat,
      sourceEventId: delta.sourceEventId,
      availableStake: delta.availableStake,
      suspended: delta.suspended
    });
  }
}

function latestDeltaTimestamp(deltas: OddsDelta[], fallback: string) {
  return deltas.reduce((latest, delta) => {
    return new Date(delta.collectedAt).getTime() > new Date(latest).getTime()
      ? delta.collectedAt
      : latest;
  }, fallback);
}

function cmdReconcileIntervalMs() {
  return Math.min(Math.max(envInt("CMD_RECONCILE_MS", 15_000), 15_000), 45_000);
}

function cmdSnapshotSettleMs(mode: "bootstrap" | "reconcile") {
  if (mode === "bootstrap") {
    return Math.min(Math.max(envInt("CMD_BOOTSTRAP_SETTLE_MS", 8_000), 1_000), 20_000);
  }
  return 500;
}

function cmdDomScanIntervalMs() {
  return Math.max(envInt("CMD_DOM_SCAN_MS", 200), 100);
}

function cmdLivePollIntervalMs() {
  return Math.min(Math.max(envInt("CMD_LIVE_POLL_MS", 2_000), 1_000), 10_000);
}

function cmdTodayPollIntervalMs() {
  return Math.min(Math.max(envInt("CMD_TODAY_POLL_MS", 2_000), 1_000), 30_000);
}

function cmdObserverHealthIntervalMs() {
  return Math.min(Math.max(envInt("CMD_OBSERVER_HEALTH_MS", 2_000), 1_000), 10_000);
}

function cmdObserverObservationSettleMs() {
  return Math.min(Math.max(envInt("CMD_OBSERVATION_SETTLE_MS", 350), 100), 1_000);
}

function cmdRuntimeLoopIntervalMs() {
  return Math.min(Math.max(Math.floor(cmdObserverHealthIntervalMs() / 2), 250), 1_000);
}
