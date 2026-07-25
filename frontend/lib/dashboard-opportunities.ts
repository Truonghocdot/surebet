import type {
  BackendOdds,
  BackendOpportunity
} from "@/lib/server-dashboard-data";

const CURRENT_OPPORTUNITY_AGE_MS = 15_000;
const DEFAULT_MISSING_GRACE_MS = 10_000;
const ODDS_TOLERANCE = 0.001;

type BackendOpportunityLeg = BackendOpportunity["legs"][number];

export type DashboardOpportunityLeg = BackendOpportunityLeg & {
  selection_label: string;
  source_label: string;
};

export type DashboardOpportunity = Omit<BackendOpportunity, "legs"> & {
  match_name: string;
  market_label: string;
  legs: DashboardOpportunityLeg[];
};

type ResolvedOpportunity = {
  item: DashboardOpportunity;
};

export function buildActiveDashboardOpportunities(
  opportunities: BackendOpportunity[],
  odds: BackendOdds[],
  now = Date.now()
): DashboardOpportunity[] {
  const activeQuotes = indexActiveQuotes(odds);
  const seen = new Set<string>();
  const result: DashboardOpportunity[] = [];

  for (const opportunity of opportunities) {
    if (
      seen.has(opportunity.id) ||
      opportunity.match_ambiguous ||
      opportunity.legs.length !== 2 ||
      !isCurrentOpportunity(opportunity, now)
    ) {
      continue;
    }

    const resolved = resolveOpportunity(opportunity, activeQuotes);
    if (!resolved) {
      continue;
    }

    seen.add(opportunity.id);
    result.push(resolved.item);
  }

  return result.sort(compareDashboardOpportunities);
}

export function createDashboardOpportunityStabilizer(options: {
  missingGraceMs?: number;
} = {}) {
  const missingGraceMs = options.missingGraceMs ?? DEFAULT_MISSING_GRACE_MS;
  let accepted: DashboardOpportunity[] = [];
  const missingSince = new Map<string, number>();

  return (
    next: DashboardOpportunity[],
    odds: BackendOdds[],
    now = Date.now()
  ): DashboardOpportunity[] => {
    const activeQuotes = indexActiveQuotes(odds);
    const nextByID = new Map(next.map((item) => [item.id, item]));
    const retained: DashboardOpportunity[] = [];

    for (const previous of accepted) {
      if (nextByID.has(previous.id)) {
        missingSince.delete(previous.id);
        continue;
      }

      const firstMissingAt = missingSince.get(previous.id) ?? now;
      missingSince.set(previous.id, firstMissingAt);
      if (now - firstMissingAt >= missingGraceMs) {
        missingSince.delete(previous.id);
        continue;
      }

      const resolved = resolveOpportunity(previous, activeQuotes);
      if (resolved) {
        retained.push(resolved.item);
      } else {
        missingSince.delete(previous.id);
      }
    }

    const merged = [...next, ...retained];
    const mergedByID = new Map(merged.map((item) => [item.id, item]));
    const existingIDs = new Set(accepted.map((item) => item.id));
    const newItems = next
      .filter((item) => !existingIDs.has(item.id))
      .sort(compareDashboardOpportunities);
    const stableItems = accepted
      .map((item) => mergedByID.get(item.id))
      .filter((item): item is DashboardOpportunity => Boolean(item));

    accepted = [...newItems, ...stableItems];
    return accepted;
  };
}

function resolveOpportunity(
  opportunity: BackendOpportunity,
  activeQuotes: Map<string, BackendOdds>
): ResolvedOpportunity | null {
  const quotes = opportunity.legs.map((leg) => activeQuotes.get(quoteKey(leg)));
  if (quotes.some((quote) => !quote)) {
    return null;
  }

  const resolvedQuotes = quotes as BackendOdds[];
  if (
    resolvedQuotes.some(
      (quote, index) =>
        quote.market_id.trim().toLowerCase() !==
          opportunity.legs[index].market_id.trim().toLowerCase() ||
        Math.abs(quote.odds - opportunity.legs[index].odds) > ODDS_TOLERANCE
    ) ||
    !sameActiveMarket(resolvedQuotes[0], resolvedQuotes[1])
  ) {
    return null;
  }

  const displayQuote = resolvedQuotes[0];
  return {
    item: {
      ...opportunity,
      match_name: displayMatchName(displayQuote, opportunity.fixture_id),
      market_label: displayMarketLabel(displayQuote),
      legs: opportunity.legs.map((leg, index) => ({
        ...leg,
        selection_label: displaySelectionLabel(resolvedQuotes[index]),
        source_label: displaySourceLabel(resolvedQuotes[index])
      }))
    }
  };
}

function indexActiveQuotes(odds: BackendOdds[]) {
  const result = new Map<string, BackendOdds>();
  for (const quote of odds) {
    if (
      quote.suspended ||
      quote.odds === 0 ||
      quote.match_state === "finished"
    ) {
      continue;
    }
    result.set(quoteKey(quote), quote);
  }
  return result;
}

function sameActiveMarket(left: BackendOdds, right: BackendOdds) {
  return normalizeMarketType(left) === normalizeMarketType(right) &&
    normalizePeriod(left) === normalizePeriod(right) &&
    normalizeAsianLine(left.line) === normalizeAsianLine(right.line);
}

function normalizeAsianLine(value: string) {
  return formatAsianLine(value).replace(/^\+/, "");
}

function displayMatchName(quote: BackendOdds, fallback: string) {
  if (quote.home_team.trim() && quote.away_team.trim()) {
    return `${quote.home_team.trim()} vs ${quote.away_team.trim()}`;
  }
  return quote.match_name.trim() || fallback;
}

function displayMarketLabel(quote: BackendOdds) {
  const kind = normalizeMarketType(quote) === "over_under" ? "Tài xỉu" : "Kèo chấp";
  const period = normalizePeriod(quote) === "1H" ? "Hiệp 1" : "Toàn trận";
  return `${kind} - ${period}`;
}

function displaySelectionLabel(quote: BackendOdds) {
  if (normalizeMarketType(quote) === "over_under") {
    const side = quote.side.trim().toLowerCase() === "under" ? "Xỉu" : "Tài";
    return `${side} ${formatAsianLine(quote.line)}`.trim();
  }

  const side = quote.side.trim().toLowerCase();
  const team = side === "home"
    ? quote.home_team.trim()
    : side === "away"
      ? quote.away_team.trim()
      : stripOutcomeLine(quote.outcome_name);
  const rawLine = extractOutcomeLine(quote.outcome_name) || quote.line;
  return `${team || stripOutcomeLine(quote.outcome_name)} ${formatAsianLine(rawLine, true)}`.trim();
}

function displaySourceLabel(quote: BackendOdds) {
  if (quote.lobby_id.trim().toLowerCase() === "cmd") {
    return "CMD";
  }
  if (quote.bookmaker_id.trim().toLowerCase() === "8xbet") {
    return "8xbet";
  }
  return quote.lobby_id && quote.lobby_id !== "default"
    ? `${quote.bookmaker_id}/${quote.lobby_id}`
    : quote.bookmaker_id;
}

function normalizeMarketType(quote: BackendOdds) {
  const value = `${quote.market_type} ${quote.market_id}`.toLowerCase();
  return value.includes("over_under") || value.includes("o-u-ou")
    ? "over_under"
    : "handicap";
}

function normalizePeriod(quote: BackendOdds) {
  const value = `${quote.period} ${quote.market_id}`.toLowerCase();
  return /(?:1h|1st|first)/.test(value) ? "1H" : "FT";
}

function extractOutcomeLine(value: string) {
  return value.match(/([+-]?\d+(?:\.\d+)?(?:\/[+-]?\d+(?:\.\d+)?)?)\s*$/)?.[1] ?? "";
}

function stripOutcomeLine(value: string) {
  return value.replace(/\s*[+-]?\d+(?:\.\d+)?(?:\/[+-]?\d+(?:\.\d+)?)?\s*$/, "").trim();
}

function formatAsianLine(value: string, preserveSign = false) {
  const raw = value.trim();
  if (!raw) {
    return "";
  }
  const parts = raw.split("/");
  const leadingSign = raw.startsWith("-") ? -1 : raw.startsWith("+") ? 1 : 0;
  const parsed = parts.map((part, index) => {
    const explicitSign = part.startsWith("-") || part.startsWith("+");
    const numeric = Number(part);
    if (!Number.isFinite(numeric)) {
      return Number.NaN;
    }
    if (index > 0 && !explicitSign && leadingSign !== 0) {
      return Math.abs(numeric) * leadingSign;
    }
    return numeric;
  });
  if (parsed.some((item) => !Number.isFinite(item))) {
    return raw;
  }

  const average = parsed.reduce((sum, item) => sum + item, 0) / parsed.length;
  const absolute = Math.abs(average).toFixed(2).replace(/\.?0+$/, "");
  if (!preserveSign) {
    return absolute;
  }
  if (average < 0 || Object.is(average, -0) || leadingSign < 0) {
    return `-${absolute}`;
  }
  if (leadingSign > 0) {
    return `+${absolute}`;
  }
  return absolute;
}

function isCurrentOpportunity(opportunity: BackendOpportunity, now: number) {
  const detectedAt = Date.parse(opportunity.detected_at);
  const expiresAt = Date.parse(opportunity.expires_at);
  return Number.isFinite(detectedAt) &&
    Number.isFinite(expiresAt) &&
    now - detectedAt <= CURRENT_OPPORTUNITY_AGE_MS &&
    expiresAt >= now;
}

function compareDashboardOpportunities(
  left: DashboardOpportunity,
  right: DashboardOpportunity
) {
  if (left.verification_status !== right.verification_status) {
    return left.verification_status === "confirmed" ? -1 : 1;
  }
  const detectedDelta = Date.parse(right.detected_at) - Date.parse(left.detected_at);
  return detectedDelta || left.id.localeCompare(right.id);
}

function quoteKey(
  quote: Pick<BackendOdds, "bookmaker_id" | "lobby_id" | "fixture_id" | "outcome_id"> |
    Pick<BackendOpportunityLeg, "bookmaker_id" | "lobby_id" | "fixture_id" | "outcome_id">
) {
  return [quote.bookmaker_id, quote.lobby_id, quote.fixture_id, quote.outcome_id]
    .map((value) => value.trim())
    .join("\u0000");
}
