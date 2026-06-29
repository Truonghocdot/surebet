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
import { parseJun88BtiSnapshot } from "./parsers/jun88-bti-parser.js";

export class Jun88BtiRuntime implements StreamingCollectorRuntime {
  constructor(private readonly collectorId: string) {}

  async collect(context: CollectContext) {
    if (!context.session) {
      throw new Error(
        `Jun88 BTI runtime requires a shared session. Run "npm run bootstrap:jun88" first.`
      );
    }

    if (!context.session.accessibleLobbies.includes("bti")) {
      throw new Error(
        `Shared session does not include lobby BTI. Re-run "npm run bootstrap:jun88".`
      );
    }

    const lobby = JUN88_LOBBIES.find((item) => item.lobbyId === "bti");
    if (!lobby) {
      throw new Error("Jun88 BTI lobby configuration is missing.");
    }

    return withJun88LobbyPage(context.session, lobby, async (page) => {
      await page.waitForSelector(".master_fe_Event_match", { timeout: 20_000 });
      const html = await page.content();
      return parseJun88BtiSnapshot(html, page.url());
    });
  }

  async stream(context: CollectContext, sink: CollectorSink) {
    if (!context.session) {
      throw new Error(
        `Jun88 BTI runtime requires a shared session. Run "npm run bootstrap:jun88" first.`
      );
    }

    if (!context.session.accessibleLobbies.includes("bti")) {
      throw new Error(
        `Shared session does not include lobby BTI. Re-run "npm run bootstrap:jun88".`
      );
    }

    const lobby = JUN88_LOBBIES.find((item) => item.lobbyId === "bti");
    if (!lobby) {
      throw new Error("Jun88 BTI lobby configuration is missing.");
    }

    return withJun88LobbyPage(context.session, lobby, async (page) => {
      try {
        await page.waitForSelector(".master_fe_Event_match", { timeout: 20_000 });

        const initialHTML = await page.content();
        const initialSnapshot = parseJun88BtiSnapshot(initialHTML, page.url());
        await sink.pushBootstrap(initialSnapshot);
        await sink.heartbeat(heartbeatOf(initialSnapshot.source));

        await installBtiObserver(page, initialSnapshot.source.collectorId);

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

async function installBtiObserver(page: import("playwright").Page, collectorId: string) {
  const script = `
    ((runtimeCollectorId) => {
      const win = window;
      if (!win.__surebet_bti_stream__) {
        win.__surebet_bti_stream__ = { queue: [], seen: {} };
      }
      const state = win.__surebet_bti_stream__;
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

          for (const selectionNode of Array.from(marketNode.querySelectorAll(".master_fe_Selections_selection"))) {
            const outcomeName = text(selectionNode.querySelector(".master_fe_Selections_selectionNameLine")) || "";
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

      for (const eventCard of Array.from(document.querySelectorAll(".master_fe_Event_match.featured-matches-card-prelive-no-bg"))) {
        enqueueFromCard(eventCard);
      }

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
      void runtimeCollectorId;
    })
  `;

  await page.evaluate(`${script}(${JSON.stringify(collectorId)})`);
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
