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
import { withJun88BookmakerPage } from "./jun88-bookmaker-page.js";
import { parseJun88BtiSnapshot } from "./parsers/jun88-bti-parser.js";
import { assertSnapshotHasSelections } from "./streaming-utils.js";

export class Jun88BtiRuntime implements StreamingCollectorRuntime {
  constructor(private readonly collectorId: string) {}

  async collect(context: CollectContext) {
    const lobby = requireLobbyConfig("bti");
    return withJun88BookmakerPage(lobby, context.pageURL, async (page) => {
      await page.waitForSelector(".master_fe_Event_match", { timeout: 20_000 });
      const html = await page.content();
      const snapshot = parseJun88BtiSnapshot(html, page.url());
      assertSnapshotHasSelections(snapshot, this.collectorId);
      return snapshot;
    });
  }

  async stream(context: CollectContext, sink: CollectorSink) {
    const lobby = requireLobbyConfig("bti");
    return withJun88BookmakerPage(lobby, context.pageURL, async (page) => {
      try {
        await page.waitForSelector(".master_fe_Event_match", { timeout: 20_000 });

        const initialHTML = await page.content();
        const initialSnapshot = parseJun88BtiSnapshot(initialHTML, page.url());
        assertSnapshotHasSelections(initialSnapshot, this.collectorId);
        await sink.pushBootstrap(initialSnapshot);
        await sink.heartbeat(heartbeatOf(initialSnapshot.source));

        await installBtiObserver(page, initialSnapshot);

        let lastHeartbeatAt = Date.now();
        while (!page.isClosed()) {
          const deltas = await readBtiDeltas(page);
          if (deltas.length > 0) {
            await sink.pushDelta(
              deltas.map((delta) => ({
                ...delta,
                source: initialSnapshot.source
              }))
            );
          }

          if (Date.now() - lastHeartbeatAt >= 15_000) {
            await sink.heartbeat(heartbeatOf(initialSnapshot.source));
            lastHeartbeatAt = Date.now();
          }

          await page.waitForTimeout(300);
        }
      } catch (error) {
        await writeDebugArtifacts(page, `${this.collectorId}-stream-failed`);
        throw new Error(`[${this.collectorId}] stream failed: ${formatError(error)}`);
      }
    });
  }
}

function requireLobbyConfig(lobbyId: "bti") {
  const lobby = JUN88_LOBBIES.find((item) => item.lobbyId === lobbyId);
  if (!lobby) {
    throw new Error(`Jun88 ${lobbyId.toUpperCase()} lobby configuration is missing.`);
  }
  return lobby;
}

async function installBtiObserver(page: import("playwright").Page, snapshot: { source: CollectorSource; selections: Array<{ fixtureId: string; marketId: string; outcomeId: string; outcomeName: string; odds: number }> }) {
  const seededFingerprints = Object.fromEntries(
    snapshot.selections.map((selection) => [
      selection.outcomeId,
      `${selection.odds}|${selection.outcomeName}`
    ])
  );
  const script = `
    ((seededFingerprints) => {
      const win = window;
      if (!win.__surebet_bti_stream__) {
        win.__surebet_bti_stream__ = { queue: [], seen: {} };
      }
      const state = win.__surebet_bti_stream__;
      state.seen = Object.assign({}, seededFingerprints || {});
      if (state.observer) {
        state.observer.disconnect();
      }

      const normalizeToken = (value) =>
        value
          .normalize("NFKD")
          .replace(/[^\\p{L}\\p{N}]+/gu, "-")
          .replace(/^-+|-+$/g, "")
          .toLowerCase();
      const text = (node) => (node && node.textContent ? node.textContent.replace(/\\s+/g, " ").trim() : "");
      const getTeamTitles = (eventCard) => {
        const titles = Array.from(eventCard.querySelectorAll(".master_fe_EventName_eventName__title"))
          .map((node) => text(node))
          .filter(Boolean);
        if (titles.length >= 2) {
          return titles;
        }
        return Array.from(eventCard.querySelectorAll(".master_fe_Participant_participantName span[title]"))
          .map((node) => text(node))
          .filter(Boolean);
      };
      const getFixtureId = (eventCard) => {
        const href = eventCard.querySelector('a[href*="/asian-view/"]')?.getAttribute("href") || "";
        const parts = href.split("/").filter(Boolean);
        return parts.at(-1) || "";
      };

      const enqueueFromCard = (eventCard) => {
        const fixtureId = getFixtureId(eventCard);
        const teams = getTeamTitles(eventCard);
        if (!fixtureId || teams.length < 2) {
          return;
        }

        for (const marketNode of Array.from(eventCard.querySelectorAll(".master_fe_Markets_container"))) {
          const marketName = text(marketNode.querySelector(".master_fe_Markets_eventMarket__marketName")) || "";
          const marketId = normalizeToken(marketName);
          if (!marketId) {
            continue;
          }

          const visiblePage = marketNode.querySelector('[data-swipeable="true"][aria-hidden="false"]') || marketNode;
          for (const selectionNode of Array.from(visiblePage.querySelectorAll(".master_fe_Selections_selection"))) {
            const selectionName = text(selectionNode.querySelector(".master_fe_Selections_selectionNameLine > span:first-child")) || text(selectionNode.querySelector(".master_fe_Selections_selectionNameLine")) || "";
            const points = text(selectionNode.querySelector(".master_fe_Selections_points")) || "";
            const outcomeName = [selectionName, points].filter(Boolean).join(" ").trim();
            const oddsText = text(selectionNode.querySelector(".master_fe_Selections_odds"));
            const odds = Number.parseFloat(oddsText);
            if (!outcomeName || !Number.isFinite(odds)) {
              continue;
            }

            const outcomeId = fixtureId + ":" + marketId + ":" + normalizeToken(outcomeName);
            const fingerprint = odds + "|" + outcomeName;
            if (state.seen[outcomeId] === fingerprint) {
              continue;
            }

            state.seen[outcomeId] = fingerprint;
            state.queue.push({
              collectedAt: new Date().toISOString(),
              fixtureId,
              homeTeam: teams[0],
              awayTeam: teams[1],
              marketId,
              outcomeId,
              outcomeName,
              odds,
              availableStake: 0,
              suspended: false,
              op: "upsert"
            });
          }
        }
      };

      const observer = new MutationObserver((mutations) => {
        const eventCards = new Set();
        for (const mutation of mutations) {
          const target = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
          const eventCard = target && target.closest ? target.closest(".master_fe_Event_match.featured-matches-card-prelive-no-bg") : null;
          if (eventCard) {
            eventCards.add(eventCard);
          }
        }
        for (const eventCard of eventCards) {
          enqueueFromCard(eventCard);
        }
      });

      observer.observe(document.body, { subtree: true, childList: true, characterData: true });
      state.observer = observer;
    })
  `;

  await page.evaluate(`${script}(${JSON.stringify(seededFingerprints)})`);
}

async function readBtiDeltas(page: import("playwright").Page) {
  return page.evaluate(() => {
    const win = window as typeof window & {
      __surebet_bti_stream__?: {
        queue: OddsDelta[];
      };
    };

    const queue = win.__surebet_bti_stream__?.queue ?? [];
    if (queue.length === 0) {
      return [];
    }

    win.__surebet_bti_stream__!.queue = [];
    return queue;
  });
}

function heartbeatOf(source: CollectorSource): CollectorHeartbeat {
  return {
    collectorId: source.collectorId,
    bookmakerId: source.bookmakerId,
    lobbyId: source.lobbyId,
    sentAt: new Date().toISOString()
  };
}
