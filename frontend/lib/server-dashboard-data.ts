import "server-only";
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

export type BackendOdds = {
  bookmaker_id: string;
  lobby_id: string;
  fixture_id: string;
  fixture_marker: string;
  league_name: string;
  home_team: string;
  away_team: string;
  match_state: string;
  event_start_at?: string | null;
  match_name: string;
  period: string;
  market_type: string;
  line: string;
  side: string;
  market_id: string;
  outcome_id: string;
  outcome_name: string;
  odds: number;
  decimal_odds: number;
  available_stake: number;
  suspended: boolean;
  collected_at: string;
  last_observed_at?: string;
  changed_at?: string;
};

export async function fetchBackendOpportunities() {
  const payload = await fetchBackendJSON<{ data: BackendOpportunity[] }>("/v1/surebets");
  return payload.data ?? [];
}

export async function fetchBackendConfirmedOpportunities() {
  const internalToken = (
    process.env.SUREBET_INTERNAL_TOKEN ?? process.env.TELEGRAM_BOT_TOKEN ?? ""
  ).trim();
  if (!internalToken) {
    throw new Error("SUREBET_INTERNAL_TOKEN chưa được cấu hình cho frontend server.");
  }

  const payload = await fetchBackendJSON<{ data: BackendOpportunity[] }>(
    "/v2/internal/surebets/confirmed",
    {
      headers: {
        "X-Surebet-Internal-Token": internalToken
      }
    }
  );
  return payload.data ?? [];
}

export async function fetchBackendOdds(includeSuspended = false) {
  const suffix = includeSuspended ? "?include_suspended=true" : "";
  const payload = await fetchBackendJSON<{ data: BackendOdds[] }>(`/v1/odds${suffix}`);
  return payload.data;
}
