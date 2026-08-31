import type { Frame, Page } from "playwright";

export const JUN88_VD_TO_VND = 1_000;

export type BookmakerAccountBalance = {
  amount: number;
  currency: string;
  amountVnd?: number;
  displayText?: string;
};

export async function readJun88CmdAccountBalance(
  target: Page | Frame
): Promise<BookmakerAccountBalance | null> {
  const candidates = typeof (target as Page).frames === "function"
    ? (target as Page).frames()
    : [target];
  for (const candidate of candidates) {
    const balance = await readJun88BalanceFromFrame(candidate);
    if (balance) return balance;
  }
  return null;
}

async function readJun88BalanceFromFrame(
  target: Page | Frame
): Promise<BookmakerAccountBalance | null> {
  const value = target.locator("#lb_bet_credits").first();
  if (await value.count().catch(() => 0) === 0) return null;

  const rawAmount = (await value.textContent({ timeout: 500 }).catch(() => null))?.trim() ?? "";
  const amount = parseLocalizedAccountBalance(rawAmount);
  if (amount === null) {
    return null;
  }

  const rowText = (await target.locator("#tdBalances td.b").first()
    .textContent({ timeout: 500 }).catch(() => null)) ?? "";
  const currency = accountCurrency(rowText, "VD");
  const amountVnd = safeIntegerVndAmount(amount * JUN88_VD_TO_VND);

  return {
    amount,
    currency,
    amountVnd,
    displayText: `${currency} ${rawAmount}`.trim()
  };
}

export async function readEightXBetAccountBalance(
  page: Page
): Promise<BookmakerAccountBalance | null> {
  const balanceButton = page.locator('[data-testid="user-now-balance-btn"]').first();
  if (!await balanceButton.isVisible().catch(() => false)) return null;

  const balanceText = balanceButton.locator('[data-testid="balance-text"]').first();
  if (!await balanceText.isVisible().catch(() => false)) return null;

  const rawAmount = (await balanceText.textContent({ timeout: 500 }).catch(() => null))?.trim() ?? "";
  const amount = parseLocalizedAccountBalance(rawAmount);
  if (amount === null) return null;

  const balanceGroupText = (await balanceText.locator("xpath=parent::*")
    .textContent({ timeout: 500 }).catch(() => null)) ?? "";
  const currency = accountCurrency(balanceGroupText, "VND");
  return {
    amount,
    currency,
    amountVnd: amount,
    displayText: `${currency} ${rawAmount}`.trim()
  };
}

export function parseLocalizedAccountBalance(value: string): number | null {
  const token = value.replace(/\u00a0/g, " ").match(/-?\d[\d.,\s]*/)?.[0]
    ?.replace(/\s/g, "");
  if (!token) {
    return null;
  }

  const lastDot = token.lastIndexOf(".");
  const lastComma = token.lastIndexOf(",");
  let normalized = token;
  if (lastDot >= 0 && lastComma >= 0) {
    const decimal = lastDot > lastComma ? "." : ",";
    const thousands = decimal === "." ? /,/g : /\./g;
    normalized = token.replace(thousands, "");
    if (decimal === ",") normalized = normalized.replace(",", ".");
  } else {
    const separator = lastDot >= 0 ? "." : lastComma >= 0 ? "," : "";
    if (separator) {
      const pieces = token.split(separator);
      const groupedThousands = pieces.length > 2 ||
        (pieces.length === 2 && pieces[1].length === 3 && pieces[0] !== "0");
      normalized = groupedThousands
        ? pieces.join("")
        : `${pieces[0]}.${pieces.slice(1).join("")}`;
    }
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function accountCurrency(value: string, fallback: string) {
  const withoutLabels = value.replace(/-?\d[\d.,\s]*/g, " ");
  return withoutLabels.match(/\b[A-Za-z]{1,12}\b/)?.[0]?.toUpperCase() ?? fallback;
}

function safeIntegerVndAmount(value: number) {
  const rounded = Math.round(value);
  return Number.isSafeInteger(rounded) && rounded >= 0 ? rounded : undefined;
}
