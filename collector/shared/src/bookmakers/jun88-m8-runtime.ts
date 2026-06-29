import type { CollectContext, CollectorRuntime } from "../contracts.js";
import { JUN88_LOBBIES } from "./jun88-lobbies.js";
import { withJun88LobbyPage } from "./jun88-lobby-page.js";
import { parseJun88M8Snapshot } from "./parsers/jun88-m8-parser.js";

const M8_READY_SELECTOR = "tr[oddsid], .Span_titleleague";

export class Jun88M8Runtime implements CollectorRuntime {
  constructor(private readonly collectorId: string) {}

  async collect(context: CollectContext) {
    if (!context.session) {
      throw new Error(
        `Jun88 M8 runtime requires a shared session. Run "npm run bootstrap:jun88" first.`
      );
    }

    if (!context.session.accessibleLobbies.includes("m8")) {
      throw new Error(
        `Shared session does not include lobby M8. Re-run "npm run bootstrap:jun88".`
      );
    }

    const lobby = JUN88_LOBBIES.find((item) => item.lobbyId === "m8");
    if (!lobby) {
      throw new Error("Jun88 M8 lobby configuration is missing.");
    }

    return withJun88LobbyPage(context.session, lobby, async (page) => {
      await page.waitForSelector(M8_READY_SELECTOR, { timeout: 20_000 }).catch(() => undefined);
      const html = await page.content();
      return parseJun88M8Snapshot(html, page.url(), this.collectorId);
    });
  }
}
