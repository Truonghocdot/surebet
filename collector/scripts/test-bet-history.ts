import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { extractHistoryPageSummary } from "./history-check-utils.js";

async function main() {
  const jun88HTML = await readFile(
    path.resolve(process.cwd(), "../docs/lobbby/jun888/betting/history/inday.html"),
    "utf8",
  );
  const jun88Summary = extractHistoryPageSummary(jun88HTML);
  assert.equal(jun88Summary.sessionTimeout, false);
  assert.equal(jun88Summary.hasHistoryMarker, true);
  assert.ok(jun88Summary.ticketIDs.includes("HDP18460501634"));
  assert.ok(jun88Summary.rowCount > 0);

  const successHTML = await readFile(
    path.resolve(process.cwd(), "../docs/lobbby/8xbet/betting/bett-success.html"),
    "utf8",
  );
  assert.match(successHTML, /sport-cart-bet-success-status/i);

  const sessionTimeout = extractHistoryPageSummary(
    `<script>parent.location='../../Main/Logout.aspx?code=SessionTimeout';</script>`,
  );
  assert.equal(sessionTimeout.sessionTimeout, true);

  console.log("bet history parser checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
