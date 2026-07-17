import type { Frame, Page } from "playwright";
import type {
  CollectorSource,
  CollectContext,
  CollectorHeartbeat,
  CollectorSink,
  OddsDelta,
  OddsSelection,
  OddsSnapshot,
  QuoteConfirmationRequest,
  StreamingCollectorRuntime
} from "../contracts.js";
import { formatError, writeDebugArtifacts } from "../core/debug.js";
import { envInt } from "../core/env.js";
import { JUN88_LOBBIES } from "./jun88-lobbies.js";
import { withJun88BookmakerPage } from "./jun88-bookmaker-page.js";
import { parseJun88CmdSnapshot } from "./parsers/jun88-cmd-parser.js";
import {
  assertSnapshotHasSelections,
  buildDeltas,
  heartbeatIntervalMs,
  heartbeatOf,
  selectionMap
} from "./streaming-utils.js";

const CMD_READY_SELECTOR = ".match.default-match, .league.tableDiv-league-header";
const CMD_DELTA_BINDING = "__surebet_cmd_emit__";

export class Jun88CmdRuntime implements StreamingCollectorRuntime {
  constructor(private readonly collectorId: string) {}

  async collect(context: CollectContext): Promise<OddsSnapshot> {
    const lobby = requireLobbyConfig("cmd");
    return withJun88BookmakerPage(lobby, context.pageURL, async (page) => {
      const target = await resolveCmdContentTarget(page);
      const snapshot = parseJun88CmdSnapshot(await target.content(), target.url(), this.collectorId);
      assertSnapshotHasSelections(snapshot, this.collectorId);
      return snapshot;
    });
  }

  async stream(context: CollectContext, sink: CollectorSink): Promise<void> {
    const lobby = requireLobbyConfig("cmd");
    return withJun88BookmakerPage(lobby, context.pageURL, async (page) => {
      try {
        let target = await resolveCmdContentTarget(page);

        // Phase B: extract only match table HTML instead of full page dump
        const initialHtml = await extractCmdMatchHtml(target);
        const initialSnapshot = parseJun88CmdSnapshot(initialHtml, target.url(), this.collectorId);
        assertSnapshotHasSelections(initialSnapshot, this.collectorId);
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
            selection = await readCmdConfirmedSelection(target, request);
          }
          return {
            observedAt: new Date().toISOString(),
            selection
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
        await installCmdObserver(target, initialSnapshot);
        await sink.pushBootstrap(initialSnapshot);
        await sink.heartbeat(heartbeatOf(initialSnapshot.source));
        let lastHeartbeatAt = Date.now();
        let lastReconcileAt = Date.now();
        const heartbeatMs = heartbeatIntervalMs();

        while (!page.isClosed()) {
          if (streamFailure) {
            throw streamFailure;
          }

          if (Date.now() - lastReconcileAt >= cmdReconcileIntervalMs()) {
            const reconciledHtml = await extractCmdMatchHtml(target);
            const reconciledSnapshot = parseJun88CmdSnapshot(
              reconciledHtml,
              target.url(),
              this.collectorId
            );
            assertSnapshotHasSelections(reconciledSnapshot, this.collectorId);
            const reconciledSnapshotMap = selectionMap(reconciledSnapshot);
            const removed = buildDeltas(
              reconciledSnapshot,
              activeSnapshotMap,
              reconciledSnapshotMap
            ).filter((delta) => delta.op === "remove");
            activeSnapshot = {
              ...reconciledSnapshot,
              selections: []
            };
            activeSnapshotMap = reconciledSnapshotMap;
            await installCmdObserver(target, reconciledSnapshot);
            await sink.pushBootstrap(reconciledSnapshot);
            if (removed.length > 0) {
              await sink.pushDelta(removed);
            }
            lastReconcileAt = Date.now();
            continue;
          }

          if (Date.now() - lastHeartbeatAt >= heartbeatMs) {
            await sink.heartbeat(heartbeatOf(activeSnapshot.source));
            lastHeartbeatAt = Date.now();
          }

			await page.waitForTimeout(Math.max(Math.floor(heartbeatMs / 2), 250));
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

    const selection = (rows[fixtureId] ?? []).find(
      (item) =>
        item.fixtureId === fixtureId &&
        item.marketId === marketId &&
        item.outcomeId === outcomeId
    );

    return selection ? { ...selection } : null;
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

async function installCmdObserver(
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
    ((seededFingerprints, bindingName) => {
      const win = window;
      if (!win.__surebet_cmd_stream__) {
        win.__surebet_cmd_stream__ = { queue: [], seen: {}, byRow: {} };
      }
      const state = win.__surebet_cmd_stream__;
      state.seen = Object.assign({}, seededFingerprints || {});
      if (state.observer) state.observer.disconnect();

      const text = (node) => (node && node.textContent ? node.textContent.replace(/\\s+/g, " ").trim() : "");
      const normalizeToken = (value) =>
        value.normalize("NFKD").replace(/[^\\p{L}\\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").toLowerCase();
      const parseOdds = (value) => Number.parseFloat((value || "").replace(/[^\\d./-]+/g, ""));
      const isSuspended = (node) =>
        !node ||
        node.hasAttribute("disabled") ||
        node.getAttribute("aria-disabled") === "true" ||
        /disabled|locked|suspend|cursor-default/i.test(node.className || "");
      const quoteId = (fixtureId, marketId, outcomeName) => fixtureId + ":" + marketId + ":" + normalizeToken(outcomeName);
      const normalizeHandicapLine = (line, side) => {
        if (!line) return "";
        if (side === "home") return line.startsWith("-") ? line : "+" + line;
        return line.startsWith("-") ? line.slice(1) : "-" + line;
      };
      const formatOutcome = (name, line) => [name, line].filter(Boolean).join(" ").trim();
      const marketIdOf = (prefix, kind) => {
        const isFirstHalf = String(prefix || "").trim().toUpperCase() === "1H";
        if (kind === "handicap") return isFirstHalf ? "hdp-ah-1st" : "hdp-ah";
        if (kind === "over_under") return isFirstHalf ? "o-u-ou-1st" : "o-u-ou";
        if (kind === "one_x_two") return isFirstHalf ? "1x2-1st" : "1x2";
        return normalizeToken(prefix + "-" + kind);
      };

      const selection = (node, fixtureId, homeTeam, awayTeam, leagueName, marketId, outcomeName) => {
        if (!node) return null;
        const odds = parseOdds(text(node));
        if (!Number.isFinite(odds)) return null;
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
          odds,
          availableStake: 0,
          suspended: isSuspended(node)
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
        if (!homeTeam || !awayTeam) return [];
        const fixtureId = baseRow.getAttribute("groupid") || [leagueName, homeTeam, awayTeam, matchID].filter(Boolean).join("|");

        const parseMarketRow = (rowNode, prefix) => {
          if (!rowNode) return [];
          const selections = [];

          for (const hdpNode of Array.from(rowNode.querySelectorAll(".w-hdp .tableDiv-match-odds"))) {
            const line = text(hdpNode.querySelector("b"));
            const buttons = Array.from(hdpNode.querySelectorAll(".tableDiv-match-odds__detail > a"));
            const marketId = marketIdOf(prefix, "handicap");
            const home = selection(buttons[0], fixtureId, homeTeam, awayTeam, leagueName, marketId, formatOutcome(homeTeam, normalizeHandicapLine(line, "home")));
            const away = selection(buttons[1], fixtureId, homeTeam, awayTeam, leagueName, marketId, formatOutcome(awayTeam, normalizeHandicapLine(line, "away")));
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
        const current = parseMatchGroup(rowKey);
        const previous = state.byRow[rowKey] || [];
        const currentMap = Object.fromEntries(current.map((item) => [item.outcomeId, item]));

        if (emit) {
          for (const item of current) {
            const fingerprint = item.odds + "|" + item.outcomeName + "|" + item.suspended;
            if (state.seen[item.outcomeId] !== fingerprint) {
              state.seen[item.outcomeId] = fingerprint;
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
                suspended: item.suspended,
                op: "upsert"
              });
            }
          }

          for (const item of previous) {
            if (!currentMap[item.outcomeId]) {
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
                op: "remove"
              });
            }
          }
        }

        state.byRow[rowKey] = current;
      };

      const removeRow = (rowNode) => {
        const rowKey = rowNode.getAttribute("groupid") || rowNode.id || "";
        if (!rowKey || !state.byRow[rowKey]) return;
        const remainingRows = Array.from(document.querySelectorAll(".match.default-match, .match.copy-match"))
          .filter((node) => (node.getAttribute("groupid") || node.id || "") === rowKey);
        if (remainingRows.length > 0) {
          syncRow(remainingRows[0], true);
          return;
        }
        for (const item of state.byRow[rowKey]) {
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
            op: "remove"
          });
        }
        delete state.byRow[rowKey];
      };

      for (const rowNode of Array.from(document.querySelectorAll(".match.default-match, .match.copy-match"))) {
        syncRow(rowNode, false);
      }

      const observer = new MutationObserver((mutations) => {
        const rows = new Set();
        const removedRows = [];
        for (const mutation of mutations) {
          const target = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
          const row = target && target.closest ? target.closest(".match.default-match, .match.copy-match") : null;
          if (row) rows.add(row);
          for (const removed of Array.from(mutation.removedNodes || [])) {
            if (removed instanceof Element) {
              if (removed.matches(".match.default-match, .match.copy-match")) removedRows.push(removed);
              for (const nested of Array.from(removed.querySelectorAll?.(".match.default-match, .match.copy-match") || [])) removedRows.push(nested);
            }
          }
        }
        for (const row of removedRows) removeRow(row);
        for (const row of rows) syncRow(row, true);
        if (state.queue.length > 0 && typeof win[bindingName] === "function") {
          const batch = state.queue.splice(0, state.queue.length);
          Promise.resolve(win[bindingName](batch)).catch(() => {
            state.queue.unshift(...batch);
          });
        }
      });

      observer.observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["class", "disabled", "aria-disabled"]
      });
      state.observer = observer;
    })
  `;

  await target.evaluate(
    `${script}(${JSON.stringify(seededFingerprints)}, ${JSON.stringify(CMD_DELTA_BINDING)})`
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
  return Math.max(envInt("CMD_RECONCILE_MS", 5 * 60_000), 60_000);
}
