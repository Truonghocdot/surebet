import type { Frame, Page } from "playwright";
import type { CollectContext, CollectorRuntime } from "../contracts.js";
import { JUN88_LOBBIES } from "./jun88-lobbies.js";
import { withJun88LobbyPage } from "./jun88-lobby-page.js";
import { parseJun88IbcSnapshot } from "./parsers/jun88-ibc-parser.js";

const IBC_READY_SELECTORS = ".c-match, .c-event-card";

export class Jun88IbcRuntime implements CollectorRuntime {
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
      return parseJun88IbcSnapshot(html, target.url(), this.collectorId);
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
