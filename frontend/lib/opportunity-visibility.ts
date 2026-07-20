import type { BackendOpportunity } from "@/lib/server-dashboard-data";

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
  const profile = classifyOpportunityOddsProfile(opportunity);
  return profile === "two_negative" ||
    (profile === "one_negative_one_positive" && role === "super_admin");
}
