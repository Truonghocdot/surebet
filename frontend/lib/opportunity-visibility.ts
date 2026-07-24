import type { BackendOpportunity } from "@/lib/server-dashboard-data";
import type { OpportunityBoard } from "@/features/dashboard/schemas/crm-schemas";

export type OpportunityOddsProfile =
  | "one_negative_one_positive"
  | "two_negative"
  | "unknown";

export function classifyOpportunityOddsProfile(
  opportunity: Pick<BackendOpportunity, "legs">
): OpportunityOddsProfile {
  let negativeCount = 0;
  let positiveCount = 0;

  for (const leg of opportunity.legs) {
    if (leg.odds < 0) {
      negativeCount += 1;
      continue;
    }
    if (leg.odds > 0) {
      positiveCount += 1;
    }
  }

  if (negativeCount >= 2 && positiveCount === 0) {
    return "two_negative";
  }
  if (negativeCount >= 1 && positiveCount >= 1) {
    return "one_negative_one_positive";
  }
  return "unknown";
}

export function filterOpportunitiesForRole(
  opportunities: BackendOpportunity[],
  role: string | null | undefined
) {
  return opportunities.filter((opportunity) =>
    isOpportunityVisibleForRole(opportunity, role)
  );
}

export function isOpportunityVisibleForRole(
  opportunity: Pick<BackendOpportunity, "legs">,
  role: string | null | undefined
) {
  return isOpportunityOddsProfileVisibleForRole(
    classifyOpportunityOddsProfile(opportunity),
    role
  );
}

export function isOpportunityOddsProfileVisibleForRole(
  profile: OpportunityOddsProfile,
  role: string | null | undefined
) {
  return profile === "two_negative" ||
    (profile === "one_negative_one_positive" && role === "super_admin");
}

export function filterOpportunityBoardForRole(
  board: OpportunityBoard,
  role: string | null | undefined
): OpportunityBoard {
  let changed = false;
  const items = board.items.map((fixture) => {
    if (
      !fixture.has_surebet ||
      isOpportunityOddsProfileVisibleForRole(fixture.odds_profile, role)
    ) {
      return fixture;
    }

    changed = true;
    return {
      ...fixture,
      opportunity_id: "",
      market_name: "",
      profit_percentage: 0,
      expected_return: 0,
      odds_profile: "unknown" as const,
      confirmed_at: "",
      expires_at: "",
      has_surebet: false,
      verification_status: "none" as const,
      valid_until: "",
      match_confidence: 0,
      match_ambiguous: false,
      sources: fixture.sources.map((source) => ({
        ...source,
        handicap: clearOpportunityMarkets(source.handicap),
        over_under: clearOpportunityMarkets(source.over_under)
      }))
    };
  });

  return changed ? { ...board, items } : board;
}

function clearOpportunityMarkets(
  markets: OpportunityBoard["items"][number]["sources"][number]["handicap"]
) {
  return markets.map((market) => ({
    ...market,
    outcomes: market.outcomes.map((outcome) => ({
      ...outcome,
      is_surebet_leg: false,
      is_candidate_leg: false
    }))
  }));
}
