import type { CurrentOpportunityBoardItem } from "@/lib/opportunity-board";

type StabilityOptions = {
  collapseGraceMs?: number;
  idleResetMs?: number;
};

const DEFAULT_COLLAPSE_GRACE_MS = 10_000;
const DEFAULT_IDLE_RESET_MS = 30_000;

export function createOpportunityBoardStabilizer(options: StabilityOptions = {}) {
  const collapseGraceMs = options.collapseGraceMs ?? DEFAULT_COLLAPSE_GRACE_MS;
  const idleResetMs = options.idleResetMs ?? DEFAULT_IDLE_RESET_MS;
  let accepted: CurrentOpportunityBoardItem[] = [];
  let collapseStartedAt = 0;
  let lastObservedAt = 0;

  return (next: CurrentOpportunityBoardItem[], now = Date.now()) => {
    if (lastObservedAt > 0 && now - lastObservedAt > idleResetMs) {
      accepted = next;
      collapseStartedAt = 0;
      lastObservedAt = now;
      return next;
    }
    lastObservedAt = now;

    if (!isSuspiciousCollapse(accepted.length, next.length)) {
      accepted = next;
      collapseStartedAt = 0;
      return next;
    }

    collapseStartedAt ||= now;
    if (now - collapseStartedAt >= collapseGraceMs) {
      accepted = next;
      collapseStartedAt = 0;
      return next;
    }

    const nextIDs = new Set(next.map((item) => item.id));
    return [
      ...next,
      ...accepted
        .filter((item) => !nextIDs.has(item.id))
        .map(clearTransientOpportunity)
    ];
  };
}

function isSuspiciousCollapse(previousCount: number, nextCount: number) {
  if (previousCount === 0) {
    return false;
  }
  if (nextCount === 0) {
    return true;
  }
  return previousCount >= 4 && nextCount < previousCount / 2;
}

function clearTransientOpportunity(
  item: CurrentOpportunityBoardItem
): CurrentOpportunityBoardItem {
  return {
    ...item,
    opportunity_id: "",
    market_name: "",
    profit_percentage: 0,
    expected_return: 0,
    odds_profile: "unknown",
    confirmed_at: "",
    expires_at: "",
    has_surebet: false,
    verification_status: "none",
    valid_until: "",
    match_confidence: 0,
    match_ambiguous: false,
    sources: item.sources.map((source) => ({
      ...source,
      handicap: clearMarkets(source.handicap),
      over_under: clearMarkets(source.over_under)
    }))
  };
}

function clearMarkets(
  markets: CurrentOpportunityBoardItem["sources"][number]["handicap"]
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
