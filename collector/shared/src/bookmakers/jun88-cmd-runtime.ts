import type { Frame, Page } from "playwright";
import type { CollectContext, CollectorRuntime } from "../contracts.js";
import { JUN88_LOBBIES } from "./jun88-lobbies.js";
import { withJun88LobbyPage } from "./jun88-lobby-page.js";
import { parseJun88CmdSnapshot } from "./parsers/jun88-cmd-parser.js";

const CMD_READY_SELECTOR = ".match.default-match, .league.tableDiv-league-header";

export class Jun88CmdRuntime implements CollectorRuntime {
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
      const html = await target.content();
      return parseJun88CmdSnapshot(html, target.url(), this.collectorId);
    });
  }
}

async function resolveCmdContentTarget(page: Page) {
  await page.waitForSelector("#contentIframe", { timeout: 20_000 });

  const iframe = await page.locator("#contentIframe").elementHandle();
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
    if (await frame.locator(CMD_READY_SELECTOR).count()) {
      return;
    }

    await frame.page().waitForTimeout(250);
  }

  throw new Error("Jun88 CMD frame did not render match content in time.");
}
