import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { installCmdObserver } from "../shared/src/bookmakers/jun88-cmd-runtime.js";
import { parseJun88CmdSnapshot } from "../shared/src/bookmakers/parsers/jun88-cmd-parser.js";

void main();

async function main() {
  const fixturePath = resolve(process.cwd(), "../docs/lobbby/jun888/cmd.html");
  const html = await readFile(fixturePath, "utf8");
  const snapshot = parseJun88CmdSnapshot(html, "https://cmd.test", "jun88-cmd");
  assert.ok(snapshot.selections.length > 0, "CMD fixture must contain selections");

  process.env.CMD_DOM_SCAN_MS = "100";
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const batches: unknown[][] = [];
    await page.exposeBinding("__surebet_cmd_emit__", async (_source, value) => {
      if (Array.isArray(value)) {
        batches.push(value);
      }
    });
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    await installCmdObserver(page, snapshot);

    const changedOdds = await page.evaluate(() => {
      const state = (
        window as typeof window & {
          __surebet_cmd_stream__?: { observer?: MutationObserver };
        }
      ).__surebet_cmd_stream__;
      state?.observer?.disconnect();

      const node = document.querySelector(
        ".match.default-match .w-hdp .tableDiv-match-odds__detail > a"
      );
      if (!node) {
        throw new Error("CMD fixture has no handicap odds node");
      }
      const current = Number.parseFloat(node.textContent?.trim() || "0");
      const next = Number((current + 0.01).toFixed(2));
      node.textContent = String(next);
      return next;
    });

    await assertEventually(() => batches.flat().some((item) => {
      const delta = item as { odds?: number; op?: string };
      return delta.op === "upsert" && delta.odds === changedOdds;
    }));
    console.log(`CMD observer fallback emitted odds ${changedOdds}`);
  } finally {
    await browser.close();
  }
}

async function assertEventually(predicate: () => boolean) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
  assert.fail("CMD observer fallback did not emit within 2 seconds");
}
