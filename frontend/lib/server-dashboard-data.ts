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

export async function fetchBackendOpportunities() {
  const payload = await fetchBackendJSON<{ data: BackendOpportunity[] }>("/v1/surebets");
  return payload.data;
}
