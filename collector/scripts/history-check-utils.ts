const sensitiveKeyPattern = /authorization|bearer|cookie|credential|jwt|password|secret|session|signature|token/i;

export type HistoryPageSummary = {
  sessionTimeout: boolean;
  hasHistoryMarker: boolean;
  rowCount: number;
  ticketIDs: string[];
};

export function extractHistoryPageSummary(html: string): HistoryPageSummary {
  const ticketIDs = unique([
    ...Array.from(html.matchAll(/class=["'][^"']*ticketid[^"']*["'][^>]*title=["']([^"']+)["']/gi))
      .map((match) => match[1].trim())
      .filter(Boolean),
    ...Array.from(html.matchAll(/(?:"RefNo"|"SocTransId")\s*:\s*"?([A-Za-z0-9_-]+)/gi))
      .map((match) => match[1].trim())
      .filter(Boolean),
    ...Array.from(html.matchAll(/\b(?:HDP|OU|PAR|LIVE)[0-9]{6,}\b/gi))
      .map((match) => match[0].trim())
      .filter(Boolean),
  ]);
  return {
    sessionTimeout: /SessionTimeout|Logout\.aspx/i.test(html),
    hasHistoryMarker: /bet_list|GVList|history|payment_betList/i.test(html),
    rowCount: (html.match(/class=["'][^"']*(?:ticketid|tbl_fs)[^"']*["']/gi) ?? []).length,
    ticketIDs,
  };
}

export function redactText(value: string, maxLength = 2_000) {
  const redacted = value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(
      /(["']?(?:cookie|authorization|token|password|secret)["']?\s*[:=]\s*["']?)[^"'&,\s}]+/gi,
      "$1[REDACTED]",
    );
  return redacted.length <= maxLength ? redacted : `${redacted.slice(0, maxLength)}...`;
}

export function redactURL(value: string) {
  try {
    const parsed = new URL(value);
    for (const [key, item] of parsed.searchParams.entries()) {
      if (sensitiveKeyPattern.test(key) || item.length > 32) {
        parsed.searchParams.set(key, "[REDACTED]");
      }
    }
    return parsed.toString();
  } catch {
    return redactText(value);
  }
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}
