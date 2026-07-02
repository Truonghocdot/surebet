import type { Frame, Page } from "playwright";
import type {
  CollectorSource,
  CollectContext,
  CollectorSink,
  StreamingCollectorRuntime
} from "../contracts.js";
import { formatError, writeDebugArtifacts } from "../core/debug.js";
import { JUN88_LOBBIES } from "./jun88-lobbies.js";
import { withJun88LobbyPage } from "./jun88-lobby-page.js";
import { parseJun88IbcSnapshot } from "./parsers/jun88-ibc-parser.js";
import { assertSnapshotHasSelections, heartbeatOf } from "./streaming-utils.js";
const IBC_READY_SELECTORS = ".c-match, .c-event-card";

export class Jun88IbcRuntime implements StreamingCollectorRuntime {
  constructor(private readonly collectorId: string) {}

  async collect(context: CollectContext) {
    if (!context.session) {
      throw new Error(
        `Jun88 IBC runtime requires a shared session. Run "npm run bootstrap:jun88" first.`
      );
    }

    if (!context.session.accessibleLobbies.includes("ibc")) {
      throw new Error(
        `Shared session does not include lobby IBC. Re-run "npm run bootstrap:jun88".`
      );
    }

    const lobby = JUN88_LOBBIES.find((item) => item.lobbyId === "ibc");
    if (!lobby) {
      throw new Error("Jun88 IBC lobby configuration is missing.");
    }

    return withJun88LobbyPage(context.session, lobby, async (page) => {
      const target = await resolveContentTarget(page);
      const html = await target.content();
      const snapshot = parseJun88IbcSnapshot(html, target.url(), this.collectorId);
      assertSnapshotHasSelections(snapshot, this.collectorId);
      return snapshot;
    });
  }

  async stream(context: CollectContext, sink: CollectorSink) {
    if (!context.session) {
      throw new Error(
        `Jun88 IBC runtime requires a shared session. Run "npm run bootstrap:jun88" first.`
      );
    }

    if (!context.session.accessibleLobbies.includes("ibc")) {
      throw new Error(
        `Shared session does not include lobby IBC. Re-run "npm run bootstrap:jun88".`
      );
    }

    const lobby = JUN88_LOBBIES.find((item) => item.lobbyId === "ibc");
    if (!lobby) {
      throw new Error("Jun88 IBC lobby configuration is missing.");
    }

    return withJun88LobbyPage(context.session, lobby, async (page) => {
      try {
        const target = await resolveContentTarget(page);
        const initialHTML = await target.content();
        const initialSnapshot = parseJun88IbcSnapshot(initialHTML, target.url(), this.collectorId);
        assertSnapshotHasSelections(initialSnapshot, this.collectorId);
        await sink.pushBootstrap(initialSnapshot);
        await sink.heartbeat(heartbeatOf(initialSnapshot.source));

        let lastHeartbeatAt = Date.now();
        await installIbcObserver(page, initialSnapshot);

        while (!page.isClosed()) {
          await page.waitForTimeout(300);
          const deltas = await readIbcDeltas(page);
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

async function resolveContentTarget(page: Page) {
  const pageLocator = page.locator(IBC_READY_SELECTORS).first();
  if (await pageLocator.count()) {
    return {
      content: () => page.content(),
      url: () => page.url()
    };
  }

  await page.waitForSelector(`#sportsFrame, ${IBC_READY_SELECTORS}`, {
    timeout: 20_000
  });

  const iframe = await page.locator("#sportsFrame").elementHandle();
  const frame = await iframe?.contentFrame();
  if (!frame) {
    return {
      content: () => page.content(),
      url: () => page.url()
    };
  }

  await waitForFrameContent(frame);

  return {
    content: () => frame.content(),
    url: () => frame.url()
  };
}

async function waitForFrameContent(frame: Frame) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 20_000) {
    if (await frame.locator(IBC_READY_SELECTORS).count()) {
      return;
    }

    await frame.page().waitForTimeout(250);
  }

  throw new Error("Jun88 IBC frame did not render match content in time.");
}

async function installIbcObserver(
  page: import("playwright").Page,
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
      if (!win.__surebet_ibc_stream__) {
        win.__surebet_ibc_stream__ = { queue: [], seen: {} };
      }
      const state = win.__surebet_ibc_stream__;
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
                  collectorId: "jun88-ibc",
                  bookmakerId: "jun88",
                  lobbyId: "ibc"
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

  await page.evaluate(`${script}(${JSON.stringify(seededFingerprints)})`);
}

async function readIbcDeltas(page: import("playwright").Page) {
  return page.evaluate(() => {
    const win = window as Window & {
      __surebet_ibc_stream__?: {
        queue: import("../contracts.js").OddsDelta[];
      };
    };
    const queue = win.__surebet_ibc_stream__?.queue || [];
    if (queue.length === 0) return [];
    if (win.__surebet_ibc_stream__) {
      win.__surebet_ibc_stream__.queue = [];
    }
    return queue;
  }) as Promise<import("../contracts.js").OddsDelta[]>;
}
