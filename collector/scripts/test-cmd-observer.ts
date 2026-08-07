import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import {
  buildCmdReconcileDeltas,
  configureCmdUpstreamRefresh,
  installCmdObserver,
  readStableCmdSnapshot,
  selectStableCmdSnapshotFixtures
} from "../shared/src/bookmakers/jun88-cmd-runtime.js";
import { parseJun88CmdSnapshot } from "../shared/src/bookmakers/parsers/jun88-cmd-parser.js";

void main();

async function main() {
  const fixturePath = resolve(process.cwd(), "../docs/lobbby/jun888/cmd.html");
  const html = await readFile(fixturePath, "utf8");
  const snapshot = parseJun88CmdSnapshot(html, "https://cmd.test", "jun88-cmd");
  assert.ok(snapshot.selections.length > 0, "CMD fixture must contain selections");
  const fixtureIDs = Array.from(new Set(snapshot.selections.map((selection) => selection.fixtureId)));
  assert.ok(fixtureIDs.length > 1, "CMD fixture must contain multiple fixtures");
  const changingFixtureID = fixtureIDs[0];
  const nextSnapshot = {
    ...snapshot,
    selections: snapshot.selections.map((selection) =>
      selection.fixtureId === changingFixtureID
        ? { ...selection, odds: Number((selection.odds + 0.01).toFixed(2)) }
        : selection
    )
  };
  const stableSubset = selectStableCmdSnapshotFixtures(snapshot, nextSnapshot);
  assert.equal(
    stableSubset.selections.some((selection) => selection.fixtureId === changingFixtureID),
    false,
    "CMD bootstrap must omit only the fixture which is still changing"
  );
  assert.ok(
    stableSubset.selections.length > 0,
    "A changing fixture must not prevent stable fixtures from bootstrapping"
  );

  const changedReconcileSnapshot = {
    ...snapshot,
    selections: snapshot.selections.map((selection, index) =>
      index === 0 ? { ...selection, odds: Number((selection.odds + 0.01).toFixed(2)) } : selection
    )
  };
  const reconcileDeltas = buildCmdReconcileDeltas(
    changedReconcileSnapshot,
    new Map(snapshot.selections.map((selection) => [selection.outcomeId, selection]))
  );
  assert.ok(
    reconcileDeltas.some((delta) => delta.outcomeId === snapshot.selections[0]?.outcomeId),
    "reconcile must repair an ordinary open-price change missed by the DOM observer"
  );
  assert.equal(
    reconcileDeltas.filter((delta) => delta.fixtureId === snapshot.selections[0]?.fixtureId && delta.op === "upsert").length,
    snapshot.selections.filter((selection) => selection.fixtureId === snapshot.selections[0]?.fixtureId).length,
    "reconcile must resend the complete affected fixture"
  );

  await testAsyncUpstreamRenderOrdering(html, snapshot);

  process.env.CMD_DOM_SCAN_MS = "100";
  process.env.CMD_LIVE_POLL_MS = "2000";
  process.env.CMD_TODAY_POLL_MS = "5000";
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const batches: unknown[][] = [];
    const observations: Array<{ fixtureIds?: string[]; observedAt?: string }> = [];
    await page.exposeBinding("__surebet_cmd_emit__", async (_source, value) => {
      if (Array.isArray(value)) {
        batches.push(value);
      }
    });
    await page.exposeBinding("__surebet_cmd_observe__", async (_source, value) => {
      if (value && typeof value === "object") {
        observations.push(value as { fixtureIds?: string[]; observedAt?: string });
      }
    });
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    const stableRead = await readStableCmdSnapshot(page, "jun88-cmd", "bootstrap");
    assert.ok(stableRead, "CMD bootstrap read must return a snapshot");
    assert.equal(
      stableRead?.snapshot.selections.length,
      snapshot.selections.length,
      "CMD bootstrap fingerprint must preserve all parsed selections"
    );
    const reconcileOdds = await page.evaluate(() => {
      const node = document.querySelector(
        ".match.default-match .w-hdp .tableDiv-match-odds__detail > a"
      );
      if (!node) {
        throw new Error("CMD fixture has no odds node for reconcile test");
      }
      const current = Number.parseFloat(node.textContent?.trim() || "0");
      const next = Number((current + 0.03).toFixed(2));
      setTimeout(() => {
        node.textContent = String(next);
      }, 100);
      return next;
    });
    const reconciledRead = await readStableCmdSnapshot(page, "jun88-cmd", "reconcile");
    assert.ok(
      reconciledRead?.snapshot.selections.some((selection) => selection.odds === reconcileOdds),
      "CMD reconcile must wait for the changed fixture before returning a snapshot"
    );
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      const win = window as typeof window & Record<string, unknown>;
      win.LastRunningVersion = "version-1";
      win.onLoadedIncRunningData = () => undefined;
    });
    await configureCmdUpstreamRefresh(page);
    await installCmdObserver(page, snapshot);

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 350));
    assert.equal(observations.length, 0, "An unchanged DOM must not fake an upstream observation");
    await page.evaluate(() => {
      const callback = (window as typeof window & Record<string, unknown>)
        .onLoadedIncRunningData;
      if (typeof callback === "function") {
        callback();
      }
    });
    await assertEventually(() => observations.length === 1);
    assert.equal(
      observations[0]?.fixtureIds?.length,
      fixtureIDs.length,
      "One upstream response must observe all stable fixtures in one binding call"
    );

    const observerOutcomeIDs = new Set(await page.evaluate(() => {
      const state = (
        window as typeof window & {
          __surebet_cmd_stream__?: { byRow?: Record<string, Array<{ outcomeId: string }>> };
        }
      ).__surebet_cmd_stream__;
      return Object.values(state?.byRow ?? {}).flat().map((selection) => selection.outcomeId);
    }));
    const missingObserverOutcomes = snapshot.selections.filter(
      (selection) => !observerOutcomeIDs.has(selection.outcomeId)
    );
    assert.deepEqual(
      missingObserverOutcomes,
      [],
      "CMD observer must preserve the snapshot handicap side and line identities"
    );

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
    const changedBatch = batches.find((batch) => batch.some((item) => {
      const delta = item as { odds?: number; op?: string };
      return delta.op === "upsert" && delta.odds === changedOdds;
    })) ?? [];
    const changedFixtureID = (changedBatch.find((item) =>
      (item as { odds?: number }).odds === changedOdds
    ) as { fixtureId?: string } | undefined)?.fixtureId;
    assert.equal(
      changedBatch.filter((item) =>
        (item as { fixtureId?: string; op?: string }).fixtureId === changedFixtureID &&
        (item as { op?: string }).op === "upsert"
      ).length,
      snapshot.selections.filter((selection) => selection.fixtureId === changedFixtureID).length,
      "A changed CMD price must emit the complete stable fixture"
    );
    console.log(`CMD observer fallback emitted odds ${changedOdds}`);

    batches.length = 0;
    const settledOdds = await page.evaluate(async () => {
      const nodes = Array.from(document.querySelectorAll(
        ".match.default-match .w-hdp .tableDiv-match-odds__detail > a"
      )).slice(0, 2);
      if (nodes.length !== 2) {
        throw new Error("CMD fixture has no complete handicap pair");
      }
      const values = nodes.map((node, index) =>
        Number((Number.parseFloat(node.textContent?.trim() || "0") + 0.02 + index * 0.01).toFixed(2))
      );
      nodes[0].textContent = String(values[0]);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
      nodes[1].textContent = String(values[1]);
      return values;
    });
    await assertEventually(() => batches.some((batch) => {
      const odds = batch
        .filter((item) => (item as { op?: string }).op === "upsert")
        .map((item) => (item as { odds?: number }).odds);
      return settledOdds.every((value) => odds.includes(value));
    }));
    assert.equal(
      batches.some((batch) => {
        const odds = batch.map((item) => (item as { odds?: number }).odds);
        return settledOdds.some((value) => odds.includes(value)) &&
          !settledOdds.every((value) => odds.includes(value));
      }),
      false,
      "CMD must not emit an intermediate one-sided market state"
    );
    console.log("CMD observer emitted one settled two-sided market batch");

    batches.length = 0;
    await page.evaluate(() => {
      const market = document.querySelector(
        ".match.default-match .w-ou .tableDiv-match-odds"
      );
      if (!market) {
        throw new Error("CMD fixture has no O/U market");
      }
      market.classList.add("hide");
    });
    await assertEventually(() => batches.flat().some((item) => {
      const delta = item as { marketId?: string; op?: string; suspended?: boolean };
      return delta.op === "upsert" &&
        (delta.marketId === "o-u-ou" || delta.marketId === "o-u-ou-1st") &&
        delta.suspended === true;
    }));
    console.log("CMD observer suspended a hidden O/U market");

    batches.length = 0;
    await page.evaluate(() => {
      const market = document.querySelector(
        ".match.default-match .w-ou .tableDiv-match-odds.hide"
      );
      if (!market) {
        throw new Error("CMD fixture has no hidden O/U market");
      }
      market.remove();
    });
    await assertEventually(() => batches.flat().some((item) => {
      const delta = item as { marketId?: string; op?: string };
      return delta.op === "remove" &&
        (delta.marketId === "o-u-ou" || delta.marketId === "o-u-ou-1st");
    }));
    console.log("CMD observer removed an O/U market missing from the DOM");

    await page.setContent(html, { waitUntil: "domcontentloaded" });
    const omittedFixtureID = fixtureIDs[0];
    const partialBootstrap = {
      ...snapshot,
      selections: snapshot.selections.filter(
        (selection) => selection.fixtureId !== omittedFixtureID
      )
    };
    batches.length = 0;
    await installCmdObserver(page, partialBootstrap);
    await assertEventually(() => batches.flat().some((item) => {
      const delta = item as { fixtureId?: string; op?: string };
      return delta.fixtureId === omittedFixtureID && delta.op === "upsert";
    }));
    console.log("CMD observer emitted a fixture omitted from the partial bootstrap");
  } finally {
    await browser.close();
  }
}

async function testAsyncUpstreamRenderOrdering(html: string, snapshot: ReturnType<typeof parseJun88CmdSnapshot>) {
  process.env.CMD_DOM_SCAN_MS = "100";
  process.env.CMD_OBSERVATION_SETTLE_MS = "350";
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const events: Array<{ kind: "delta" | "observe"; at: number }> = [];
    let nextOdds = 0;
    await page.exposeBinding("__surebet_cmd_emit__", async (_source, value) => {
      if (Array.isArray(value) && value.some((item) => (item as { odds?: number }).odds === nextOdds)) {
        events.push({ kind: "delta", at: Date.now() });
      }
    });
    await page.exposeBinding("__surebet_cmd_observe__", async () => {
      events.push({ kind: "observe", at: Date.now() });
    });
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      const win = window as typeof window & Record<string, unknown>;
      win.LastRunningVersion = "async-render-test";
      win.onLoadedIncRunningData = () => {
        const node = document.querySelector(
          ".match.default-match .w-hdp .tableDiv-match-odds__detail > a"
        );
        if (!node) return;
        const current = Number.parseFloat(node.textContent?.trim() || "0");
        const next = Number((current + 0.02).toFixed(2));
        setTimeout(() => {
          node.textContent = String(next);
        }, 250);
      };
    });
    nextOdds = await page.evaluate(() => {
      const node = document.querySelector(
        ".match.default-match .w-hdp .tableDiv-match-odds__detail > a"
      );
      const current = Number.parseFloat(node?.textContent?.trim() || "0");
      return Number((current + 0.02).toFixed(2));
    });
    await configureCmdUpstreamRefresh(page);
    await installCmdObserver(page, snapshot);
    await page.evaluate(() => {
      const callback = (window as typeof window & Record<string, unknown>).onLoadedIncRunningData;
      if (typeof callback === "function") callback();
    });
    await assertEventually(() => events.some((event) => event.kind === "delta") &&
      events.some((event) => event.kind === "observe"));
    const deltaAt = events.find((event) => event.kind === "delta")?.at ?? 0;
    const observeAt = events.find((event) => event.kind === "observe")?.at ?? 0;
    assert.ok(deltaAt > 0 && observeAt > 0 && deltaAt <= observeAt,
      `upstream observation must follow DOM delta (events=${JSON.stringify(events)})`);
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
