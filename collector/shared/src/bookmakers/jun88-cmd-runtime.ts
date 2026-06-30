import type { Frame, Page } from "playwright";
import type {
  CollectorSource,
  CollectContext,
  CollectorHeartbeat,
  CollectorSink,
  OddsDelta,
  StreamingCollectorRuntime
} from "../contracts.js";
import { formatError, writeDebugArtifacts } from "../core/debug.js";
import { JUN88_LOBBIES } from "./jun88-lobbies.js";
import { withJun88LobbyPage } from "./jun88-lobby-page.js";
import { parseJun88CmdSnapshot } from "./parsers/jun88-cmd-parser.js";
import { heartbeatOf } from "./streaming-utils.js";

const CMD_READY_SELECTOR = ".match.default-match, .league.tableDiv-league-header";

export class Jun88CmdRuntime implements StreamingCollectorRuntime {
  constructor(private readonly collectorId: string) {}

  async collect(context: CollectContext) {
    if (!context.session) {
      throw new Error(
        `Jun88 CMD runtime requires a shared session. Run "npm run bootstrap:jun88" first.`
      );
    }

    if (!context.session.accessibleLobbies.includes("cmd")) {
      throw new Error(
        `Shared session does not include lobby CMD. Re-run "npm run bootstrap:jun88".`
      );
    }

    const lobby = JUN88_LOBBIES.find((item) => item.lobbyId === "cmd");
    if (!lobby) {
      throw new Error("Jun88 CMD lobby configuration is missing.");
    }

    return withJun88LobbyPage(context.session, lobby, async (page) => {
      const target = await resolveCmdContentTarget(page);
      return parseJun88CmdSnapshot(await target.content(), target.url(), this.collectorId);
    });
  }

  async stream(context: CollectContext, sink: CollectorSink) {
    if (!context.session) {
      throw new Error(
        `Jun88 CMD runtime requires a shared session. Run "npm run bootstrap:jun88" first.`
      );
    }

    if (!context.session.accessibleLobbies.includes("cmd")) {
      throw new Error(
        `Shared session does not include lobby CMD. Re-run "npm run bootstrap:jun88".`
      );
    }

    const lobby = JUN88_LOBBIES.find((item) => item.lobbyId === "cmd");
    if (!lobby) {
      throw new Error("Jun88 CMD lobby configuration is missing.");
    }

    return withJun88LobbyPage(context.session, lobby, async (page) => {
      try {
        const target = await resolveCmdContentTarget(page);
        const initialSnapshot = parseJun88CmdSnapshot(
          await target.content(),
          target.url(),
          this.collectorId
        );
        await sink.pushBootstrap(initialSnapshot);
        await sink.heartbeat(heartbeatOf(initialSnapshot.source));
        await installCmdObserver(target, initialSnapshot);
        let lastHeartbeatAt = Date.now();

        while (!page.isClosed()) {
          await page.waitForTimeout(300);
          const deltas = await readCmdDeltas(target);
          if (deltas.length > 0) {
            await sink.pushDelta(deltas);
          }

          if (Date.now() - lastHeartbeatAt >= 15_000) {
            await sink.heartbeat(heartbeatOf(initialSnapshot.source));
            lastHeartbeatAt = Date.now();
          }
        }
      } catch (error) {
        await writeDebugArtifacts(page, `${this.collectorId}-stream-failed`);
        throw new Error(`[${this.collectorId}] stream failed: ${formatError(error)}`);
      }
    });
  }
}

async function resolveCmdContentTarget(page: Page): Promise<Page | Frame> {
  await page.waitForSelector("#contentIframe", { timeout: 20_000 });

  const iframe = await page.locator("#contentIframe").elementHandle();
  const frame = await iframe?.contentFrame();
  if (!frame) {
    return page;
  }

  await waitForFrameContent(frame);
  return frame;
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
      const quoteId = (fixtureId, marketName, outcomeName) => fixtureId + ":" + normalizeToken(marketName) + ":" + normalizeToken(outcomeName);
      const normalizeHandicapLine = (line, side) => {
        if (!line) return "";
        if (side === "home") return line.startsWith("-") ? line : "+" + line;
        return line.startsWith("-") ? line.slice(1) : "-" + line;
      };
      const formatOutcome = (name, line) => [name, line].filter(Boolean).join(" ").trim();

      const selection = (node, fixtureId, marketName, outcomeName, suspended) => {
        if (!node) return null;
        const odds = parseOdds(text(node));
        if (!Number.isFinite(odds)) return null;
        return {
          fixtureId,
          marketId: normalizeToken(marketName),
          outcomeId: quoteId(fixtureId, marketName, outcomeName),
          outcomeName,
          odds,
          availableStake: 0,
          suspended: !!suspended
        };
      };

      const parseMatch = (matchNode) => {
        const matchID = (matchNode.id || "").replace(/^R_/, "");
        const previousLeague = matchNode.previousElementSibling && matchNode.previousElementSibling.classList.contains("league")
          ? matchNode.previousElementSibling.querySelector("label")
          : matchNode.closest(".tableDiv")?.querySelector(".league label");
        const leagueName = text(previousLeague);
        const homeTeam = text(matchNode.querySelector("#ht_" + matchID)) || text(matchNode.querySelector(".tableDiv-match-info__event div:first-child"));
        const awayTeam = text(matchNode.querySelector("#at_" + matchID)) || text(matchNode.querySelector(".tableDiv-match-info__event div:nth-child(2)"));
        const drawLabel = text(matchNode.querySelector(".drawcss")) || "Hòa";
        if (!homeTeam || !awayTeam) return [];
        const fixtureId = matchNode.getAttribute("groupid") || [leagueName, homeTeam, awayTeam, matchID].filter(Boolean).join("|");

        const parseMarketRow = (rowNode, prefix) => {
          if (!rowNode) return [];
          const selections = [];

          const hdpNode = rowNode.querySelector(".w-hdp .tableDiv-match-odds");
          if (hdpNode) {
            const line = text(hdpNode.querySelector("b"));
            const buttons = Array.from(hdpNode.querySelectorAll(".tableDiv-match-odds__detail > a"));
            const home = selection(buttons[0], fixtureId, prefix + " Handicap", formatOutcome(homeTeam, normalizeHandicapLine(line, "home")), false);
            const away = selection(buttons[1], fixtureId, prefix + " Handicap", formatOutcome(awayTeam, normalizeHandicapLine(line, "away")), false);
            if (home) selections.push(home);
            if (away) selections.push(away);
          }

          const ouNode = rowNode.querySelector(".w-ou .tableDiv-match-odds");
          if (ouNode) {
            const line = text(ouNode.querySelector("b"));
            const buttons = Array.from(ouNode.querySelectorAll(".tableDiv-match-odds__detail a"));
            const over = selection(buttons[0], fixtureId, prefix + " Over/Under", formatOutcome("Over", line), false);
            const under = selection(buttons[1], fixtureId, prefix + " Over/Under", formatOutcome("Under", line), false);
            if (over) selections.push(over);
            if (under) selections.push(under);
          }

          const x12Node = rowNode.querySelector(".col-45 .tableDiv-match-odds__X12detail");
          if (x12Node) {
            const buttons = Array.from(x12Node.querySelectorAll("a"));
            const home = selection(buttons[0], fixtureId, prefix + " 1X2", homeTeam, false);
            const away = selection(buttons[1], fixtureId, prefix + " 1X2", awayTeam, false);
            const draw = selection(buttons[2], fixtureId, prefix + " 1X2", drawLabel, false);
            if (home) selections.push(home);
            if (away) selections.push(away);
            if (draw) selections.push(draw);
          }

          return selections;
        };

        const fullTimeRow = matchNode.querySelector(":scope > .col.row:not(.halfmatchStats)");
        const halfTimeRow = matchNode.querySelector(":scope > .col.row.halfmatchStats");
        return [
          ...parseMarketRow(fullTimeRow, "FT"),
          ...parseMarketRow(halfTimeRow, "1H")
        ];
      };

      const syncRow = (rowNode, emit) => {
        const rowKey = rowNode.id || rowNode.getAttribute("groupid") || "";
        if (!rowKey) return;
        const current = parseMatch(rowNode);
        const previous = state.byRow[rowKey] || [];
        const currentMap = Object.fromEntries(current.map((item) => [item.outcomeId, item]));
        const previousMap = Object.fromEntries(previous.map((item) => [item.outcomeId, item]));

        if (emit) {
          for (const item of current) {
            const fingerprint = item.odds + "|" + item.outcomeName;
            if (state.seen[item.outcomeId] !== fingerprint) {
              state.seen[item.outcomeId] = fingerprint;
              state.queue.push({
                source: { collectorId: "jun88-cmd", bookmakerId: "jun88", lobbyId: "cmd" },
                collectedAt: new Date().toISOString(),
                fixtureId: item.fixtureId,
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
        const rowKey = rowNode.id || rowNode.getAttribute("groupid") || "";
        if (!rowKey || !state.byRow[rowKey]) return;
        for (const item of state.byRow[rowKey]) {
          delete state.seen[item.outcomeId];
          state.queue.push({
            source: { collectorId: "jun88-cmd", bookmakerId: "jun88", lobbyId: "cmd" },
            collectedAt: new Date().toISOString(),
            fixtureId: item.fixtureId,
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

      for (const rowNode of Array.from(document.querySelectorAll(".match.default-match"))) {
        syncRow(rowNode, false);
      }

      const observer = new MutationObserver((mutations) => {
        const rows = new Set();
        const removedRows = [];
        for (const mutation of mutations) {
          const target = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
          const row = target && target.closest ? target.closest(".match.default-match") : null;
          if (row) rows.add(row);
          for (const removed of Array.from(mutation.removedNodes || [])) {
            if (removed instanceof Element) {
              if (removed.matches(".match.default-match")) removedRows.push(removed);
              for (const nested of Array.from(removed.querySelectorAll?.(".match.default-match") || [])) removedRows.push(nested);
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
