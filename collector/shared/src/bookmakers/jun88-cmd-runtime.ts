import type { Frame, Page } from "playwright";
import type {
  CollectorSource,
  CollectContext,
  CollectorHeartbeat,
  CollectorSink,
  OddsDelta,
  OddsSnapshot,
  StreamingCollectorRuntime
} from "../contracts.js";
import { formatError, writeDebugArtifacts } from "../core/debug.js";
import { JUN88_LOBBIES } from "./jun88-lobbies.js";
import { withJun88BookmakerPage } from "./jun88-bookmaker-page.js";
import { parseJun88CmdSnapshot } from "./parsers/jun88-cmd-parser.js";
import {
  assertSnapshotHasSelections,
  browserRecycleIntervalMs,
  buildDeltas,
  heartbeatIntervalMs,
  heartbeatOf,
  pageReloadIntervalMs,
  selectionMap,
  streamPollIntervalMs
} from "./streaming-utils.js";

const CMD_READY_SELECTOR = ".match.default-match, .league.tableDiv-league-header";

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
        await sink.pushBootstrap(initialSnapshot);
        await sink.heartbeat(heartbeatOf(initialSnapshot.source));
        await installCmdObserver(target, initialSnapshot);
        let activeSnapshot = initialSnapshot;
        const sessionStartedAt = Date.now();
        let lastHeartbeatAt = Date.now();
        let lastReloadAt = Date.now();
        const heartbeatMs = heartbeatIntervalMs();
        const pollIntervalMs = streamPollIntervalMs();
        const reloadIntervalMs = pageReloadIntervalMs();
        const recycleIntervalMs = browserRecycleIntervalMs();

        // Phase A: signal-driven wake-up — resolve as soon as the in-browser
        // queue has items, so we don't wait a full poll interval unnecessarily.
        let wakeUpPoll: (() => void) | null = null;
        let cancelWatcher = installCmdQueueWatcher(target, () => wakeUpPoll?.());

        while (!page.isClosed()) {
          if (Date.now() - sessionStartedAt >= recycleIntervalMs) {
            console.warn(`[${this.collectorId}] recycling browser session after TTL.`);
            return;
          }

          if (Date.now() - lastReloadAt >= reloadIntervalMs) {
            await page.reload({ waitUntil: "domcontentloaded" });
            target = await resolveCmdContentTarget(page);

            // Phase B: same optimisation on reload path
            const reloadedHtml = await extractCmdMatchHtml(target);
            const reloadedSnapshot = parseJun88CmdSnapshot(reloadedHtml, target.url(), this.collectorId);
            assertSnapshotHasSelections(reloadedSnapshot, this.collectorId);
            await sink.pushBootstrap(reloadedSnapshot);

            const removed = buildDeltas(
              reloadedSnapshot,
              selectionMap(activeSnapshot),
              selectionMap(reloadedSnapshot)
            ).filter((delta) => delta.op === "remove");
            if (removed.length > 0) {
              await sink.pushDelta(removed);
            }

            await installCmdObserver(target, reloadedSnapshot);
            cancelWatcher();
            cancelWatcher = installCmdQueueWatcher(target, () => wakeUpPoll?.());
            activeSnapshot = reloadedSnapshot;
            lastReloadAt = Date.now();
            continue;
          }

          const deltas = await readCmdDeltas(target);
          if (deltas.length > 0) {
            await sink.pushDelta(deltas);
          }

          if (Date.now() - lastHeartbeatAt >= heartbeatMs) {
            await sink.heartbeat(heartbeatOf(activeSnapshot.source));
            lastHeartbeatAt = Date.now();
          }

          // Phase A: wait for poll interval OR early wake-up from queue watcher
          const earlyWake = new Promise<void>((resolve) => { wakeUpPoll = resolve; });
          await Promise.race([
            page.waitForTimeout(pollIntervalMs),
            earlyWake
          ]);
          wakeUpPoll = null;
        }
      } catch (error) {
        await writeDebugArtifacts(page, `${this.collectorId}-stream-failed`);
        throw new Error(`[${this.collectorId}] stream failed: ${formatError(error)}`);
      }
    });
  }
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
  snapshot: { source: CollectorSource; selections: Array<{ outcomeId: string; outcomeName: string; odds: number }> }
) {
  const seededFingerprints = Object.fromEntries(
    snapshot.selections.map((selection) => [
      selection.outcomeId,
      `${selection.odds}|${selection.outcomeName}`
    ])
  );

  const script = `
    ((seededFingerprints) => {
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

      const selection = (node, fixtureId, homeTeam, awayTeam, marketId, outcomeName, suspended) => {
        if (!node) return null;
        const odds = parseOdds(text(node));
        if (!Number.isFinite(odds)) return null;
        return {
          fixtureId,
          homeTeam,
          awayTeam,
          marketId,
          outcomeId: quoteId(fixtureId, marketId, outcomeName),
          outcomeName,
          odds,
          availableStake: 0,
          suspended: !!suspended
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
            const home = selection(buttons[0], fixtureId, homeTeam, awayTeam, marketId, formatOutcome(homeTeam, normalizeHandicapLine(line, "home")), false);
            const away = selection(buttons[1], fixtureId, homeTeam, awayTeam, marketId, formatOutcome(awayTeam, normalizeHandicapLine(line, "away")), false);
            if (home) selections.push(home);
            if (away) selections.push(away);
          }

          for (const ouNode of Array.from(rowNode.querySelectorAll(".w-ou .tableDiv-match-odds"))) {
            const line = text(ouNode.querySelector("b"));
            const buttons = Array.from(ouNode.querySelectorAll(".tableDiv-match-odds__detail a"));
            const marketId = marketIdOf(prefix, "over_under");
            const over = selection(buttons[0], fixtureId, homeTeam, awayTeam, marketId, formatOutcome("Over", line), false);
            const under = selection(buttons[1], fixtureId, homeTeam, awayTeam, marketId, formatOutcome("Under", line), false);
            if (over) selections.push(over);
            if (under) selections.push(under);
          }

          for (const x12Node of Array.from(rowNode.querySelectorAll(".col-45 .tableDiv-match-odds__X12detail"))) {
            const buttons = Array.from(x12Node.querySelectorAll("a"));
            const marketId = marketIdOf(prefix, "one_x_two");
            const home = selection(buttons[0], fixtureId, homeTeam, awayTeam, marketId, homeTeam, false);
            const away = selection(buttons[1], fixtureId, homeTeam, awayTeam, marketId, awayTeam, false);
            const draw = selection(buttons[2], fixtureId, homeTeam, awayTeam, marketId, drawLabel, false);
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
            const fingerprint = item.odds + "|" + item.outcomeName;
            if (state.seen[item.outcomeId] !== fingerprint) {
              state.seen[item.outcomeId] = fingerprint;
              state.queue.push({
                source: { collectorId: "jun88-cmd", bookmakerId: "jun88", lobbyId: "cmd" },
                collectedAt: new Date().toISOString(),
                fixtureId: item.fixtureId,
                homeTeam: item.homeTeam,
                awayTeam: item.awayTeam,
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
                homeTeam: item.homeTeam,
                awayTeam: item.awayTeam,
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
            homeTeam: item.homeTeam,
            awayTeam: item.awayTeam,
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
      });

      observer.observe(document.body, { subtree: true, childList: true, characterData: true });
      state.observer = observer;
    })
  `;

  await target.evaluate(`${script}(${JSON.stringify(seededFingerprints)})`);
}

async function readCmdDeltas(target: Page | Frame) {
  return target.evaluate(() => {
    const win = window as Window & {
      __surebet_cmd_stream__?: {
        queue: import("../contracts.js").OddsDelta[];
      };
    };
    const queue = win.__surebet_cmd_stream__?.queue || [];
    if (queue.length === 0) return [];
    if (win.__surebet_cmd_stream__) {
      win.__surebet_cmd_stream__.queue = [];
    }
    return queue;
  }) as Promise<import("../contracts.js").OddsDelta[]>;
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

/**
 * Phase A: Pure Node-side queue watcher — polls the in-browser delta queue
 * length via target.evaluate() every 16 ms and calls onWake() as soon as
 * there are items. Works for both Page and Frame (no exposeFunction needed).
 * Returns a cancel function to stop the loop when the session ends.
 */
function installCmdQueueWatcher(
  target: Page | Frame,
  onWake: () => void
): () => void {
  let cancelled = false;

  const poll = async () => {
    while (!cancelled) {
      try {
        const hasItems = await target.evaluate(() => {
          const win = window as typeof window & {
            __surebet_cmd_stream__?: { queue: unknown[] };
          };
          return (win.__surebet_cmd_stream__?.queue?.length ?? 0) > 0;
        });
        if (hasItems) {
          onWake();
        }
      } catch {
        break; // target closed / navigated
      }
      // ~1 frame tick: fast enough to react quickly without burning CPU
      await new Promise<void>((r) => setTimeout(r, 16));
    }
  };

  void poll();
  return () => { cancelled = true; };
}
