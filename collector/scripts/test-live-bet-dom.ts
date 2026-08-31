import assert from "node:assert/strict";
import { chromium, type Browser } from "playwright";
import {
  EightXBetLiveBetActions,
  Jun88CmdLiveBetActions,
  readEightXBetAccountBalance,
  readJun88CmdAccountBalance,
} from "@surebet/collector-shared";

Object.assign(process.env, {
  AUTO_BET_MODE: "live",
});

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);

async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    await withTimeout(verifyJun88Actions(browser), 15_000, "Jun88 DOM actions");
    await withTimeout(verifyEightXBetActions(browser), 15_000, "8xbet DOM actions");
    console.log("live bet DOM action checks passed");
  } finally {
    await withTimeout(browser.close(), 5_000, "browser close").catch(() => undefined);
  }
}

async function verifyJun88Actions(browser: Browser) {
  console.log("[live-bet-dom] Jun88");
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.setContent(`
    <a class="odds" href="#OddsClick(this, '25212060_Hdp_Home')">-0.93</a>
    <table><tr id="tdBalances">
      <th id="tdBetCredits" class="bet_banlance">Tien cuoc</th>
      <td class="b">VD&nbsp;<span id="lb_bet_credits">1,000.00</span></td>
    </tr></table>
    <div class="PlaceBetLeft">
      <span id="lb_bet_team">Home FC</span><span id="lb_hdpball">-0.5</span><span id="lb_hdpscore">0-0</span>
      <input id="tx_bet_type" value="Hdp"><input id="tx_bet_oddsType" value="MY">
      <input id="tx_bet_odds" value="-0.93"><input id="tx_min_bet" value="20">
      <input id="tx_max_bet" value="500"><input id="tx_stake" value="20">
      <button id="btnBet">Bet</button><button id="btnCancel">Cancel</button>
    </div>
    <script>
      window.submitClicks = 0;
      window.__surebet_cmd_stream__ = { byRow: {
        'fixture-jun': [{
          fixtureId: 'fixture-jun', marketId: 'hdp-ah', outcomeId: 'outcome-1',
          providerRef: '25212060_Hdp_Home', suspended: false
        }]
      }};
      window.OddsClick = () => { document.querySelector('.PlaceBetLeft').style.display = 'block'; };
      document.querySelector('.odds').addEventListener('click', (event) => {
        event.preventDefault();
        window.OddsClick();
      });
      document.querySelector('#btnBet').addEventListener('click', () => window.submitClicks += 1);
    </script>
  `);
  const accountBalance = await readJun88CmdAccountBalance(page);
  assert.deepEqual(accountBalance, {
    amount: 1000,
    currency: "VD",
    amountVnd: 1_000_000,
    displayText: "VD 1,000.00",
  });
  const actions = new Jun88CmdLiveBetActions(page);
  const prepared = await actions.prepare(prepareRequest({
    providerRef: "25212060_Hdp_Home",
    fixtureId: "fixture-jun",
    expectedOdds: -0.93,
    expectedRawOdds: -0.93,
    oddsFormat: "malay",
  }));
  console.log("[live-bet-dom] Jun88 prepared", prepared.result);
  assert.equal(prepared.result, "prepared", prepared.result === "rejected" ? prepared.error : "");
  assert.equal(prepared.minimumStakeVnd, 20_000);
  const committed = await actions.commit(commitRequest(prepared.prepareId, -0.93));
  assert.equal(committed.result, "rejected");
  assert.match(committed.result === "rejected" ? committed.error : "", /submit is blocked/);
  console.log("[live-bet-dom] Jun88 done");
}

async function verifyEightXBetActions(browser: Browser) {
  console.log("[live-bet-dom] 8xbet");
  const context = await browser.newContext();
  await context.route("**/*", async (route) => {
    await route.fulfill({ contentType: "text/html", body: eightXBetFixtureHTML() });
  });
  const actions = new EightXBetLiveBetActions(context);
  const prepared = await actions.prepare(prepareRequest({
    providerRef: "4928833|ah|h|0",
    fixtureId: "4928833",
    expectedOdds: 0.87,
    expectedRawOdds: 0.87,
    oddsFormat: "indonesian",
  }));
  console.log("[live-bet-dom] 8xbet prepared", prepared.result);
  if (prepared.result === "rejected") console.log("[live-bet-dom] 8xbet prepare error", prepared.error.slice(0, 160));
  assert.equal(prepared.result, "prepared", prepared.result === "rejected" ? prepared.error : "");
  const committed = await actions.commit(commitRequest(prepared.prepareId, 0.87, 300));
  console.log("[live-bet-dom] 8xbet committed", committed.result);
  assert.equal(committed.result, "rejected");
  assert.match(committed.result === "rejected" ? committed.error : "", /submit is blocked/);
  const page = context.pages().find((candidate) => candidate.url().includes("/match/4928833"));
  assert(page);
  assert.deepEqual(await readEightXBetAccountBalance(page), {
    amount: 385.98,
    currency: "VND",
    amountVnd: 385.98,
    displayText: "VND 385.98",
  });
  assert.equal(await page.getByTestId("sport-cart-bet-amount-label").textContent(), "300");
  assert.equal(await page.evaluate(() => (window as typeof window & { submitClicks: number }).submitClicks), 0);
  await actions.close();
  await context.close();
}

function prepareRequest(options: {
  providerRef: string;
  fixtureId: string;
  expectedOdds: number;
  expectedRawOdds: number;
  oddsFormat: "malay" | "indonesian";
}) {
  return {
    requestId: "prepare-request",
    actionId: "action-1",
    attemptId: "attempt-1",
    opportunityId: "opportunity-1",
    legId: "leg-1",
    fixtureId: options.fixtureId,
    marketId: "hdp-ah",
    outcomeId: "outcome-1",
    providerRef: options.providerRef,
    expectedOdds: options.expectedOdds,
    expectedRawOdds: options.expectedRawOdds,
    oddsFormat: options.oddsFormat,
    quoteRevision: "quote-1",
    expiresAt: future(),
  };
}

function commitRequest(prepareId: string, expectedOdds: number, stakeVnd = 50_000) {
  return {
    requestId: "commit-request",
    actionId: "action-1",
    attemptId: "attempt-commit-1",
    opportunityId: "opportunity-1",
    legId: "leg-1",
    prepareId,
    idempotencyKey: `commit:${prepareId}`,
    stakeVnd,
    expectedOdds,
    expiresAt: future(),
  };
}

function future() {
  return new Date(Date.now() + 60_000).toISOString();
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number, label: string) {
  return Promise.race([
    operation,
    new Promise<never>((_resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
      timer.unref?.();
    }),
  ]);
}

function eightXBetFixtureHTML() {
  return `
    <button role="switch" aria-checked="false" data-testid="sport-cart-quick-bet-switch"></button>
    <button data-testid="user-now-balance-btn">
      <div><div>VND</div><p data-testid="balance-text">385.98</p></div>
      <div><span>coupon</span><span>0</span></div>
      <div><span>credit</span><span>0</span></div>
    </button>
    <button data-testid="oddsBtn-1|4928833|ah|h|0" onclick="document.querySelector('#cart').style.display='block'">-0.5 @0.87</button>
    <div id="cart" data-testid="SportCart" style="display:none">
      <div data-testid="sport-cart-single-card">Home FC -0.5 @0.87</div>
      <div data-testid="sport-cart-currency-label">VND</div>
      <div data-testid="sport-cart-bet-amount-label">12</div>
      <div data-testid="SportCalculator">
        ${["1","2","3","4","5","6","7","8","9","0"].map((digit) =>
          `<button onclick="amount('${digit}')">${digit}</button>`).join("")}
        <button id="backspace" onclick="backspace()"><svg></svg></button>
      </div>
      <button data-testid="sport-cart-bet-button">Đặt Cược</button>
    </div>
    <script>
      window.submitClicks = 0;
      const label = document.querySelector('[data-testid="sport-cart-bet-amount-label"]');
      window.amount = (digit) => label.textContent += digit;
      window.backspace = () => label.textContent = label.textContent.slice(0, -1);
      document.querySelector('[data-testid="sport-cart-bet-button"]').addEventListener('click', () => window.submitClicks += 1);
    </script>
  `;
}
