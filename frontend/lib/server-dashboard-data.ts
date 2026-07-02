import { fetchBackendJSON } from "@/lib/server-api";

export type BackendOpportunity = {
  id: string;
  fixture_id: string;
  market_name: string;
  profit_percentage: number;
  expected_return: number;
  detected_at: string;
  expires_at: string;
  legs: Array<{
    bookmaker_id: string;
    lobby_id: string;
    market_id: string;
    outcome_id: string;
    outcome_name: string;
    odds: number;
    stake: number;
  }>;
};

type BackendBookmakerAccount = {
  bookmaker_code: string;
  bookmaker_name: string;
  label: string;
  currency: string;
  balance: number;
  available_stake: number;
  is_enabled: boolean;
};

type BackendOdds = {
  bookmaker_id: string;
  lobby_id: string;
  odds: number;
  suspended: boolean;
  collected_at: string;
};

export type DashboardAccount = {
  bookmaker: string;
  bookmaker_code: string;
  account: string;
  balance: string;
  available_stake: string;
  status: string;
  session_status: string;
  readiness: string;
  live_odds: number;
  latest_seen_at: string | null;
  lobbies: string[];
};

export async function fetchBackendOpportunities() {
  const payload = await fetchBackendJSON<{ data: BackendOpportunity[] }>("/v1/surebets");
  return payload.data;
}

export async function fetchDashboardAccounts() {
  const [accountsPayload, oddsPayload] = await Promise.all([
    fetchBackendJSON<{ data: BackendBookmakerAccount[] }>("/v1/bookmaker-accounts"),
    fetchBackendJSON<{ data: BackendOdds[] }>("/v1/odds?include_suspended=true")
  ]);

  return mapDashboardAccounts(accountsPayload.data, oddsPayload.data);
}

export function mapDashboardAccounts(
  accounts: BackendBookmakerAccount[],
  odds: BackendOdds[]
): DashboardAccount[] {
  return accounts.map((account) => {
    const relatedOdds = odds.filter((item) => item.bookmaker_id === account.bookmaker_code);
    const liveOdds = relatedOdds.filter((item) => !item.suspended && item.odds !== 0).length;
    const latestSeenAt = latestCollectedAt(relatedOdds);
    const latestAgeSeconds = latestSeenAt
      ? Math.max(0, Math.floor((Date.now() - new Date(latestSeenAt).getTime()) / 1000))
      : null;
    const lobbies = Array.from(new Set(relatedOdds.map((item) => item.lobby_id))).sort();
    const status = accountStatus(account.is_enabled, liveOdds, latestAgeSeconds);

    return {
      bookmaker: account.bookmaker_name,
      bookmaker_code: account.bookmaker_code,
      account: account.label,
      balance: formatMoney(account.balance, account.currency),
      available_stake: formatMoney(account.available_stake, account.currency),
      status,
      session_status: sessionStatus(latestAgeSeconds),
      readiness: readinessStatus(account.is_enabled, liveOdds, latestAgeSeconds),
      live_odds: liveOdds,
      latest_seen_at: latestSeenAt,
      lobbies
    };
  });
}

function latestCollectedAt(items: BackendOdds[]) {
  return items.reduce<string | null>((latest, item) => {
    if (!latest) {
      return item.collected_at;
    }
    return new Date(item.collected_at).getTime() > new Date(latest).getTime()
      ? item.collected_at
      : latest;
  }, null);
}

function accountStatus(isEnabled: boolean, liveOdds: number, latestAgeSeconds: number | null) {
  if (!isEnabled) {
    return "Tắt";
  }
  if (liveOdds > 0 && latestAgeSeconds !== null && latestAgeSeconds <= 60) {
    return "Hoạt động";
  }
  if (latestAgeSeconds !== null && latestAgeSeconds <= 60) {
    return "Có feed";
  }
  if (latestAgeSeconds !== null) {
    return "Feed cũ";
  }
  return "Chưa có feed";
}

function sessionStatus(latestAgeSeconds: number | null) {
  if (latestAgeSeconds === null) {
    return "Chưa thấy session";
  }
  if (latestAgeSeconds < 60) {
    return `Session mới ${latestAgeSeconds}s trước`;
  }
  return `Session mới ${Math.floor(latestAgeSeconds / 60)} phút trước`;
}

function readinessStatus(
  isEnabled: boolean,
  liveOdds: number,
  latestAgeSeconds: number | null
) {
  if (!isEnabled) {
    return "Account đang tắt";
  }
  if (liveOdds > 0 && latestAgeSeconds !== null && latestAgeSeconds <= 60) {
    return "Sẵn sàng so kèo";
  }
  if (latestAgeSeconds !== null && latestAgeSeconds <= 60) {
    return "Có session, chưa có odds sống";
  }
  if (latestAgeSeconds !== null) {
    return "Collector cần làm mới feed";
  }
  return "Chưa nhận dữ liệu collector";
}

function formatMoney(value: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 0
    }).format(value);
  } catch {
    return `${currency || "$"}${value.toLocaleString()}`;
  }
}
