import type { Frame, Page } from "playwright";
import type {
  CollectorSource,
  CollectContext,
  CollectorSink,
  OddsSnapshot,
  StreamingCollectorRuntime
} from "../contracts.js";
import { formatError, writeDebugArtifacts } from "../core/debug.js";
import { JUN88_LOBBIES } from "./jun88-lobbies.js";
import { withJun88BookmakerPage } from "./jun88-bookmaker-page.js";
import { parseJun88M9BetSnapshot } from "./parsers/jun88-m8-parser.js";
import {
  assertSnapshotHasSelections,
  buildDeltas,
  heartbeatIntervalMs,
  heartbeatOf,
  pageReloadIntervalMs,
  selectionMap,
  streamPollIntervalMs
} from "./streaming-utils.js";

const M9BET_READY_SELECTOR = "tr[oddsid], .Span_titleleague";

export class Jun88M9BetRuntime implements StreamingCollectorRuntime {
  constructor(private readonly collectorId: string) {}

  async collect(context: CollectContext): Promise<OddsSnapshot> {
    const lobby = requireLobbyConfig("m9bet");
    return withJun88BookmakerPage(lobby, context.pageURL, async (page) => {
      const target = await resolveM9BetContentTarget(page);
      const snapshot = parseJun88M9BetSnapshot(
        await target.content(),
        target.url(),
        this.collectorId
      );
      assertSnapshotHasSelections(snapshot, this.collectorId);
      return snapshot;
    });
  }

  async stream(context: CollectContext, sink: CollectorSink): Promise<void> {
    const lobby = requireLobbyConfig("m9bet");
    return withJun88BookmakerPage(lobby, context.pageURL, async (page) => {
      try {
        let target = await resolveM9BetContentTarget(page);
        const initialSnapshot = parseJun88M9BetSnapshot(
          await target.content(),
          target.url(),
          this.collectorId
        );
        assertSnapshotHasSelections(initialSnapshot, this.collectorId);
        await sink.pushBootstrap(initialSnapshot);
        await sink.heartbeat(heartbeatOf(initialSnapshot.source));
        await installM9BetObserver(target, initialSnapshot);
        let activeSnapshot = initialSnapshot;
        let lastHeartbeatAt = Date.now();
        let lastReloadAt = Date.now();
        const heartbeatMs = heartbeatIntervalMs();
        const pollIntervalMs = streamPollIntervalMs();
        const reloadIntervalMs = pageReloadIntervalMs();

        while (!page.isClosed()) {
          if (Date.now() - lastReloadAt >= reloadIntervalMs) {
            await page.reload({ waitUntil: "domcontentloaded" });
            target = await resolveM9BetContentTarget(page);
            const reloadedSnapshot = parseJun88M9BetSnapshot(
              await target.content(),
              target.url(),
              this.collectorId
            );
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

            await installM9BetObserver(target, reloadedSnapshot);
            activeSnapshot = reloadedSnapshot;
            lastReloadAt = Date.now();
            continue;
          }

          const deltas = await readM9BetDeltas(target);
          if (deltas.length > 0) {
            await sink.pushDelta(deltas);
          }

          if (Date.now() - lastHeartbeatAt >= heartbeatMs) {
            await sink.heartbeat(heartbeatOf(activeSnapshot.source));
            lastHeartbeatAt = Date.now();
          }

          await page.waitForTimeout(pollIntervalMs);
        }
      } catch (error) {
        await writeDebugArtifacts(page, `${this.collectorId}-stream-failed`);
        throw new Error(`[${this.collectorId}] stream failed: ${formatError(error)}`);
      }
    });
  }
}

export class Jun88M8Runtime extends Jun88M9BetRuntime {}

async function resolveM9BetContentTarget(page: Page): Promise<Page | Frame> {
  await page
    .waitForSelector(`${M9BET_READY_SELECTOR}, frame[name="fraMain"], frame`, {
      timeout: 20_000
    })
    .catch(() => undefined);

  const directMatch = await page.locator(M9BET_READY_SELECTOR).count().catch(() => 0);
  if (directMatch > 0) {
    return page;
  }

  const namedFrame = page.frame({ name: "fraMain" });
  if (namedFrame) {
    const resolved = await waitForM9BetFrameContent(namedFrame).catch(() => null);
    if (resolved) {
      return namedFrame;
    }
  }

  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) {
      continue;
    }

    const resolved = await waitForM9BetFrameContent(frame).catch(() => null);
    if (resolved) {
      return frame;
    }
  }

  throw new Error("Jun88 M9Bet page/frame did not render odds rows in time.");
}

async function waitForM9BetFrameContent(frame: Frame) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 20_000) {
    if (await frame.locator(M9BET_READY_SELECTOR).count().catch(() => 0)) {
      return true;
    }

    await frame.page().waitForTimeout(250);
  }

  throw new Error("Jun88 M9Bet frame did not render odds rows in time.");
}

function requireLobbyConfig(lobbyId: "m9bet") {
  const lobby = JUN88_LOBBIES.find((item) => item.lobbyId === lobbyId);
  if (!lobby) {
    throw new Error(`Jun88 ${lobbyId.toUpperCase()} lobby configuration is missing.`);
  }
  return lobby;
}

async function installM9BetObserver(
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
      if (!win.__surebet_m9bet_stream__) {
        win.__surebet_m9bet_stream__ = { queue: [], seen: {}, byRow: {} };
      }
      const state = win.__surebet_m9bet_stream__;
      state.seen = Object.assign({}, seededFingerprints || {});
      if (state.observer) state.observer.disconnect();

      const text = (node) => (node && node.textContent ? node.textContent.replace(/\\s+/g, " ").trim() : "");
      const normalizeToken = (value) =>
        value.normalize("NFKD").replace(/[^\\p{L}\\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").toLowerCase();
      const parseOdds = (value) => Number.parseFloat((value || "").replace(/[^\\d./-]+/g, ""));
      const formatOutcome = (name, line) => [name, line].filter(Boolean).join(" ").trim();
      const normalizeHandicapLine = (line, side) => {
        const trimmed = (line || "").replace(/\\s+/g, "");
        if (!trimmed) return "";
        if (side === "home") return trimmed.startsWith("-") ? trimmed : "+" + trimmed;
        return trimmed.startsWith("-") ? trimmed.slice(1) : "-" + trimmed;
      };
      const quoteId = (fixtureId, marketName, outcomeName) => fixtureId + ":" + normalizeToken(marketName) + ":" + normalizeToken(outcomeName);

      const sanitizeTeamLabel = (value) => {
        if (!value) return "";
        return decodeURIComponent(value.replace(/\\+/g, " "))
          .replace(/\\s+\\((ET|PEN|HDP|OU)\\)$/i, "")
          .replace(/\\s+/g, " ")
          .trim();
      };

      const parseRow = (rowNode) => {
        const oddsID = rowNode.getAttribute("oddsid") || "";
        const leagueName = text(
          (rowNode.previousElementSibling && rowNode.previousElementSibling.querySelector(".Span_titleleague")) ||
          rowNode.closest("table")?.querySelector(".Span_titleleague")
        );
        const moreBetLink = rowNode.querySelector("[onclick*='MoreBetGen.aspx']")?.getAttribute("onclick") || "";
        const homeMatch = moreBetLink.match(/[?&]home=([^&']+)/i);
        const awayMatch = moreBetLink.match(/[?&]away=([^&']+)/i);
        const homeTeam = sanitizeTeamLabel(homeMatch?.[1]) || text(rowNode.querySelector(".Give, .Take"));
        const teamNodes = Array.from(rowNode.querySelectorAll(".Give, .Take"));
        const awayTeam = sanitizeTeamLabel(awayMatch?.[1]) || (teamNodes[1] ? text(teamNodes[1]) : "");
        const drawLabel = text(rowNode.querySelector(".Draw")) || "Hòa";
        const timeOrStatus = text(rowNode.querySelector(".Heading5"));
        if (!homeTeam || !awayTeam) return [];

        const fixtureId = rowNode.getAttribute("favid") || [leagueName, homeTeam, awayTeam, oddsID, timeOrStatus].filter(Boolean).join("|");
        const marketCells = Array.from(rowNode.querySelectorAll(":scope > td.Border_right_t, :scope > td.Td_t_br, :scope > td.Td_r_br"));
        if (marketCells.length < 6) return [];

        const selections = [];
        const parseHdp = (node, marketName) => {
          if (!node) return;
          const lineTexts = Array.from(node.querySelectorAll(".Heading6")).map(text).filter(Boolean);
          const buttons = Array.from(node.querySelectorAll(".PosOdds, .NegOdds"));
          const home = buttons[0];
          const away = buttons[1];
          if (home) {
            const odds = parseOdds(text(home));
            if (Number.isFinite(odds)) selections.push({
              fixtureId, homeTeam, awayTeam, marketId: normalizeToken(marketName), outcomeId: quoteId(fixtureId, marketName, formatOutcome(homeTeam, normalizeHandicapLine(lineTexts[0], "home"))),
              outcomeName: formatOutcome(homeTeam, normalizeHandicapLine(lineTexts[0], "home")), odds, availableStake: 0, suspended: false
            });
          }
          if (away) {
            const odds = parseOdds(text(away));
            const line = lineTexts[1] || lineTexts[0];
            if (Number.isFinite(odds)) selections.push({
              fixtureId, homeTeam, awayTeam, marketId: normalizeToken(marketName), outcomeId: quoteId(fixtureId, marketName, formatOutcome(awayTeam, normalizeHandicapLine(line, "away"))),
              outcomeName: formatOutcome(awayTeam, normalizeHandicapLine(line, "away")), odds, availableStake: 0, suspended: false
            });
          }
        };
        const parseOu = (node, marketName) => {
          if (!node) return;
          const line = text(node.querySelector(".Heading6"));
          const buttons = Array.from(node.querySelectorAll(".PosOdds, .NegOdds"));
          const over = buttons[0];
          const under = buttons[1];
          if (over) {
            const odds = parseOdds(text(over));
            if (Number.isFinite(odds)) selections.push({
              fixtureId, homeTeam, awayTeam, marketId: normalizeToken(marketName), outcomeId: quoteId(fixtureId, marketName, formatOutcome("Over", line)),
              outcomeName: formatOutcome("Over", line), odds, availableStake: 0, suspended: false
            });
          }
          if (under) {
            const odds = parseOdds(text(under));
            if (Number.isFinite(odds)) selections.push({
              fixtureId, homeTeam, awayTeam, marketId: normalizeToken(marketName), outcomeId: quoteId(fixtureId, marketName, formatOutcome("Under", line)),
              outcomeName: formatOutcome("Under", line), odds, availableStake: 0, suspended: false
            });
          }
        };
        const parse1x2 = (node, marketName) => {
          if (!node) return;
          const buttons = Array.from(node.querySelectorAll(".X12Odds span")).filter((button) => text(button) !== "");
          const [home, away, draw] = buttons;
          const entries = [
            [home, homeTeam],
            [away, awayTeam],
            [draw, drawLabel]
          ];
          for (const [button, outcomeName] of entries) {
            if (!button) continue;
            const odds = parseOdds(text(button));
            if (Number.isFinite(odds)) selections.push({
              fixtureId, homeTeam, awayTeam, marketId: normalizeToken(marketName), outcomeId: quoteId(fixtureId, marketName, outcomeName),
              outcomeName, odds, availableStake: 0, suspended: false
            });
          }
        };

        parseHdp(marketCells[0], "FT Handicap");
        parseOu(marketCells[1], "FT Over/Under");
        parse1x2(marketCells[2], "FT 1X2");
        parseHdp(marketCells[3], "1H Handicap");
        parseOu(marketCells[4], "1H Over/Under");
        parse1x2(marketCells[5], "1H 1X2");
        return selections;
      };

      const syncRow = (rowNode, emit) => {
        const rowKey = rowNode.getAttribute("oddsid") || rowNode.getAttribute("favid") || "";
        if (!rowKey) return;
        const current = parseRow(rowNode);
        const previous = state.byRow[rowKey] || [];
        const currentMap = Object.fromEntries(current.map((item) => [item.outcomeId, item]));

        if (emit) {
          for (const item of current) {
            const fingerprint = item.odds + "|" + item.outcomeName;
            if (state.seen[item.outcomeId] !== fingerprint) {
              state.seen[item.outcomeId] = fingerprint;
              state.queue.push({
                source: { collectorId: "jun88-m9bet", bookmakerId: "jun88", lobbyId: "m9bet" },
                collectedAt: new Date().toISOString(),
                fixtureId: item.fixtureId,
                homeTeam: item.homeTeam,
                awayTeam: item.awayTeam,
                marketId: item.marketId,
                outcomeId: item.outcomeId,
                outcomeName: item.outcomeName,
                odds: item.odds,
                availableStake: 0,
                suspended: false,
                op: "upsert"
              });
            }
          }
          for (const item of previous) {
            if (!currentMap[item.outcomeId]) {
              delete state.seen[item.outcomeId];
              state.queue.push({
                source: { collectorId: "jun88-m9bet", bookmakerId: "jun88", lobbyId: "m9bet" },
                collectedAt: new Date().toISOString(),
                fixtureId: item.fixtureId,
                homeTeam: item.homeTeam,
                awayTeam: item.awayTeam,
                marketId: item.marketId,
                outcomeId: item.outcomeId,
                outcomeName: item.outcomeName,
                odds: item.odds,
                availableStake: 0,
                suspended: true,
                op: "remove"
              });
            }
          }
        }

        state.byRow[rowKey] = current;
      };

      const removeRow = (rowNode) => {
        const rowKey = rowNode.getAttribute("oddsid") || rowNode.getAttribute("favid") || "";
        if (!rowKey || !state.byRow[rowKey]) return;
        for (const item of state.byRow[rowKey]) {
          delete state.seen[item.outcomeId];
          state.queue.push({
            source: { collectorId: "jun88-m9bet", bookmakerId: "jun88", lobbyId: "m9bet" },
            collectedAt: new Date().toISOString(),
            fixtureId: item.fixtureId,
            homeTeam: item.homeTeam,
            awayTeam: item.awayTeam,
            marketId: item.marketId,
            outcomeId: item.outcomeId,
            outcomeName: item.outcomeName,
            odds: item.odds,
            availableStake: 0,
            suspended: true,
            op: "remove"
          });
        }
        delete state.byRow[rowKey];
      };

      for (const rowNode of Array.from(document.querySelectorAll("tr[oddsid]"))) {
        syncRow(rowNode, false);
      }

      const observer = new MutationObserver((mutations) => {
        const rows = new Set();
        const removedRows = [];
        for (const mutation of mutations) {
          const target = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
          const row = target && target.closest ? target.closest("tr[oddsid]") : null;
          if (row) rows.add(row);
          for (const removed of Array.from(mutation.removedNodes || [])) {
            if (removed instanceof Element) {
              if (removed.matches("tr[oddsid]")) removedRows.push(removed);
              for (const nested of Array.from(removed.querySelectorAll?.("tr[oddsid]") || [])) removedRows.push(nested);
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

async function readM9BetDeltas(target: Page | Frame) {
  return target.evaluate(() => {
    const win = window as Window & {
      __surebet_m9bet_stream__?: {
        queue: import("../contracts.js").OddsDelta[];
      };
    };
    const queue = win.__surebet_m9bet_stream__?.queue || [];
    if (queue.length === 0) return [];
    if (win.__surebet_m9bet_stream__) {
      win.__surebet_m9bet_stream__.queue = [];
    }
    return queue;
  }) as Promise<import("../contracts.js").OddsDelta[]>;
}
