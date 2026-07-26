export type NotificationOpportunity = {
  fixture_id: string;
  market_name: string;
  legs: Array<{
    bookmaker_id: string;
    lobby_id: string;
    outcome_name: string;
    odds: number;
  }>;
};

export type OpportunityNotificationDetails = {
  matchName: string;
  marketLabel: string;
  legs: Array<{
    selectionLabel: string;
    sourceLabel: string;
    odds: number;
  }>;
};

export function buildOpportunityNotificationDetails(
  opportunity: NotificationOpportunity
): OpportunityNotificationDetails {
  return {
    matchName: formatMatchName(opportunity.fixture_id),
    marketLabel: formatMarketLabel(opportunity.market_name),
    legs: opportunity.legs.map((leg) => ({
      selectionLabel: formatSelectionLabel(opportunity.market_name, leg.outcome_name),
      sourceLabel: formatSourceLabel(leg.bookmaker_id, leg.lobby_id),
      odds: leg.odds
    }))
  };
}

export function browserNotificationBody(
  notification: OpportunityNotificationDetails & { profitPercentage: number }
) {
  const legs = notification.legs
    .map((leg) =>
      `${leg.selectionLabel} - ${leg.sourceLabel} (${formatNotificationOdds(leg.odds)})`
    )
    .join(" / ");
  return [
    notification.matchName,
    `${notification.marketLabel} | Lợi nhuận +${notification.profitPercentage.toFixed(2)}%`,
    legs
  ].filter(Boolean).join("\n");
}

export function formatNotificationOdds(value: number) {
  return value > 0 ? `+${value.toFixed(2)}` : value.toFixed(2);
}

function formatMatchName(value: string) {
  const normalized = value
    .trim()
    .replace(/\s*\|\s*/g, " vs ")
    .replace(/\s+/g, " ");
  return normalized || "Trận đấu chưa xác định";
}

function formatMarketLabel(marketName: string) {
  const normalized = marketName.trim().toLowerCase();
  const kind = normalized.includes("o-u-ou") || normalized.includes("over-under")
    ? "Tài xỉu"
    : normalized.includes("hdp-ah") || normalized.includes("handicap")
      ? "Kèo chấp"
      : marketName.trim() || "Kèo";
  const period = /(?:1st|1h|first[-_ ]?half)/i.test(normalized)
    ? "Hiệp 1"
    : "Toàn trận";
  return `${kind} - ${period}`;
}

function formatSelectionLabel(marketName: string, outcomeName: string) {
  const normalizedMarket = marketName.trim().toLowerCase();
  if (!normalizedMarket.includes("o-u-ou") && !normalizedMarket.includes("over-under")) {
    return outcomeName.trim();
  }

  const line = outcomeName.match(/([+-]?\d+(?:\.\d+)?(?:\/[+-]?\d+(?:\.\d+)?)?)\s*$/)?.[1] ?? "";
  if (/\b(?:under|xiu)\b|xỉu/i.test(outcomeName)) {
    return `Xỉu ${line}`.trim();
  }
  if (/\b(?:over|tai)\b|tài/i.test(outcomeName)) {
    return `Tài ${line}`.trim();
  }
  return outcomeName.trim();
}

function formatSourceLabel(bookmakerID: string, lobbyID: string) {
  const bookmaker = bookmakerID.trim();
  const lobby = lobbyID.trim();
  if (lobby.toLowerCase() === "cmd") {
    return "CMD";
  }
  if (bookmaker.toLowerCase() === "8xbet") {
    return "8xbet";
  }
  return lobby && lobby !== "default" ? `${bookmaker}/${lobby}` : bookmaker;
}
