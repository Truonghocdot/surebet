import type { Frame, Page } from "playwright";
import type {
  CollectorSource,
  CollectContext,
  CollectorSink,
  StreamingCollectorRuntime
} from "../contracts.js";
import { formatError, writeDebugArtifacts } from "../core/debug.js";
import { JUN88_LOBBIES } from "./jun88-lobbies.js";
import { withJun88BookmakerPage } from "./jun88-bookmaker-page.js";
import { parseJun88SabaSnapshot } from "./parsers/jun88-ibc-parser.js";
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
const SABA_READY_SELECTORS = ".c-match, .c-event-card";

export class Jun88SabaRuntime implements StreamingCollectorRuntime {
  constructor(private readonly collectorId: string) {}

  async collect(context: CollectContext) {
    const lobby = requireLobbyConfig("saba");
    return withJun88BookmakerPage(lobby, context.pageURL, async (page) => {
      const target = await resolveContentTarget(page);
      const html = await target.content();
      const snapshot = parseJun88SabaSnapshot(html, target.url(), this.collectorId);
      assertSnapshotHasSelections(snapshot, this.collectorId);
      return snapshot;
    });
  }

  async stream(context: CollectContext, sink: CollectorSink) {
    const lobby = requireLobbyConfig("saba");
    return withJun88BookmakerPage(lobby, context.pageURL, async (page) => {
      try {
        let target = await resolveContentTarget(page);
        const initialHTML = await target.content();
        const initialSnapshot = parseJun88SabaSnapshot(
          initialHTML,
          target.url(),
          this.collectorId
        );
        assertSnapshotHasSelections(initialSnapshot, this.collectorId);
        await sink.pushBootstrap(initialSnapshot);
        await sink.heartbeat(heartbeatOf(initialSnapshot.source));

        let activeSnapshot = initialSnapshot;
        const sessionStartedAt = Date.now();
        let lastHeartbeatAt = Date.now();
        let lastReloadAt = Date.now();
        const heartbeatMs = heartbeatIntervalMs();
        const pollIntervalMs = streamPollIntervalMs();
        const reloadIntervalMs = pageReloadIntervalMs();
        const recycleIntervalMs = browserRecycleIntervalMs();
        await installSabaObserver(target, initialSnapshot);

        while (!page.isClosed()) {
          if (Date.now() - sessionStartedAt >= recycleIntervalMs) {
            console.warn(`[${this.collectorId}] recycling browser session after TTL.`);
            return;
          }

          if (Date.now() - lastReloadAt >= reloadIntervalMs) {
            await page.reload({ waitUntil: "domcontentloaded" });
            target = await resolveContentTarget(page);
            const reloadedSnapshot = parseJun88SabaSnapshot(
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

            await installSabaObserver(target, reloadedSnapshot);
            activeSnapshot = reloadedSnapshot;
            lastReloadAt = Date.now();
            continue;
          }

          const deltas = await readSabaDeltas(target);
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

export class Jun88IbcRuntime extends Jun88SabaRuntime {}

function requireLobbyConfig(lobbyId: "saba") {
  const lobby = JUN88_LOBBIES.find((item) => item.lobbyId === lobbyId);
  if (!lobby) {
    throw new Error(`Jun88 ${lobbyId.toUpperCase()} lobby configuration is missing.`);
  }
  return lobby;
}

async function resolveContentTarget(page: Page): Promise<Page | Frame> {
  const pageLocator = page.locator(SABA_READY_SELECTORS).first();
  if (await pageLocator.count()) {
    return page;
  }

  await page.waitForSelector(`#sportsFrame, ${SABA_READY_SELECTORS}`, {
    timeout: 20_000
  });

  const iframe = await page.locator("#sportsFrame").elementHandle();
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
    if (await frame.locator(SABA_READY_SELECTORS).count()) {
      return;
    }

    await frame.page().waitForTimeout(250);
  }

  throw new Error("Jun88 SABA frame did not render match content in time.");
}

async function installSabaObserver(
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
      if (!win.__surebet_saba_stream__) {
        win.__surebet_saba_stream__ = { queue: [], seen: {} };
      }
      const state = win.__surebet_saba_stream__;
      state.seen = Object.assign({}, seededFingerprints || {});
      if (state.observer) {
        state.observer.disconnect();
      }

      const text = (node) => (node && node.textContent ? node.textContent.replace(/\\s+/g, " ").trim() : "");
      const normalizeToken = (value) =>
        value
          .normalize("NFKD")
          .replace(/[^\\p{L}\\p{N}]+/gu, "-")
          .replace(/^-+|-+$/g, "")
          .toLowerCase();

      const rowHomeTeam = (row, fallbackHome) => text(row.querySelector(".c-match__event .c-match__team:first-child .c-team-name")) || fallbackHome;
      const rowAwayTeam = (row, fallbackAway) => text(row.querySelector(".c-match__event .c-match__team:nth-child(2) .c-team-name")) || fallbackAway;
      const rowDraw = (row) => text(row.querySelector(".c-match__event .c-match__team:nth-child(3) > .c-text")) || "Hòa";

      const outcomeName = (button, marketName, homeTeam, awayTeam, drawLabel, buttons) => {
        const title = button.getAttribute("title");
        if (title) return title.replace(/\\s+/g, " ").trim();
        const buttonID = (button.id || "").toLowerCase();
        const sharedLine = buttons.map((current) => text(current.querySelector(".c-text-goal"))).find(Boolean) || "";
        const label = text(button.querySelector(".c-text"));
        if (label === "H") return [homeTeam, sharedLine].filter(Boolean).join(" ").trim();
        if (label === "A") return [awayTeam, sharedLine].filter(Boolean).join(" ").trim();
        if (label === "o") return ["Over", sharedLine].filter(Boolean).join(" ").trim();
        if (label === "u") return ["Under", sharedLine].filter(Boolean).join(" ").trim();
        if (label === "e") return "Even";
        if (label && label !== "x") return [label, sharedLine].filter(Boolean).join(" ").trim();
        if (buttonID.endsWith("1")) return homeTeam;
        if (buttonID.endsWith("2")) return awayTeam;
        if (buttonID.endsWith("x")) return drawLabel;
        if (buttonID.endsWith("h")) return [homeTeam, sharedLine].filter(Boolean).join(" ").trim();
        if (buttonID.endsWith("a")) return [awayTeam, sharedLine].filter(Boolean).join(" ").trim();
        return marketName;
      };

      const enqueueMatch = (matchNode) => {
        const baseHome = text(matchNode.querySelector(".c-match__team .c-team:first-child .c-team-name"));
        const baseAway = text(matchNode.querySelector(".c-match__team .c-team:nth-child(2) .c-team-name"));
        if (!baseHome || !baseAway) return;
        const leagueName = text(matchNode.closest(".c-league")?.querySelector(".c-league__name"));
        const fixtureId = matchNode.querySelector(".c-match__option")?.getAttribute("data-matchid") || [leagueName, baseHome, baseAway].filter(Boolean).join("|");
        const marketTitles = Array.from(matchNode.querySelectorAll(".c-bettype-title .c-bettype-col"))
          .map((node) => node.getAttribute("title") || text(node.querySelector(".c-text")) || text(node))
          .filter(Boolean);
        const rows = Array.from(matchNode.querySelectorAll(".c-match__odds"));

        for (const row of rows) {
          const homeTeam = rowHomeTeam(row, baseHome);
          const awayTeam = rowAwayTeam(row, baseAway);
          const drawLabel = rowDraw(row);
          const marketColumns = Array.from(row.querySelectorAll(":scope > .c-bettype-col"));

          marketColumns.forEach((column, index) => {
            const marketName = marketTitles[index] || column.getAttribute("title") || text(column);
            const buttons = Array.from(column.querySelectorAll(":scope > .c-odds-button"));
            if (!marketName || buttons.length === 0) return;

            buttons.forEach((button) => {
              const oddsText = text(button.querySelector(".c-odds"));
              const odds = Number.parseFloat(oddsText.replace(/[^\\d./-]+/g, ""));
              if (!Number.isFinite(odds)) return;
              const name = outcomeName(button, marketName, homeTeam, awayTeam, drawLabel, buttons);
              const marketId = normalizeToken(marketName);
              const id = fixtureId + ":" + marketId + ":" + normalizeToken(name);
              const fingerprint = odds + "|" + name;
              if (state.seen[id] === fingerprint) return;
              state.seen[id] = fingerprint;
              state.queue.push({
                source: {
                  collectorId: "jun88-saba",
                  bookmakerId: "jun88",
                  lobbyId: "saba"
                },
                collectedAt: new Date().toISOString(),
                fixtureId,
                homeTeam,
                awayTeam,
                marketId,
                outcomeId: id,
                outcomeName: name,
                odds,
                availableStake: 0,
                suspended: false,
                op: "upsert"
              });
            });
          });
        }
      };

      const observer = new MutationObserver((mutations) => {
        const matches = new Set();
        for (const mutation of mutations) {
          const target = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
          const matchNode = target && target.closest ? target.closest(".c-match") : null;
          if (matchNode) matches.add(matchNode);
        }
        for (const matchNode of matches) {
          enqueueMatch(matchNode);
        }
      });

      observer.observe(document.body, { subtree: true, childList: true, characterData: true });
      state.observer = observer;
    })
  `;

  await target.evaluate(`${script}(${JSON.stringify(seededFingerprints)})`);
}

async function readSabaDeltas(target: Page | Frame) {
  return target.evaluate(() => {
    const win = window as Window & {
      __surebet_saba_stream__?: {
        queue: import("../contracts.js").OddsDelta[];
      };
    };
    const queue = win.__surebet_saba_stream__?.queue || [];
    if (queue.length === 0) return [];
    if (win.__surebet_saba_stream__) {
      win.__surebet_saba_stream__.queue = [];
    }
    return queue;
  }) as Promise<import("../contracts.js").OddsDelta[]>;
}
