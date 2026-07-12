"use client";

import { DataPanel } from "@/components/dashboard/data-panel";
import { SectionHeader } from "@/components/dashboard/section-header";
import { QueryShell } from "@/features/dashboard/components/query-shell";
import {
  useOpportunitiesQuery,
  useRealtimeWebSocket
} from "@/features/dashboard/queries/use-crm-queries";
import type { Opportunity } from "@/features/dashboard/schemas/crm-schemas";

export function OpportunitiesScreen() {
  const query = useOpportunitiesQuery();
  const realtimeStatus = useRealtimeWebSocket();

  return (
    <div className="dashboard-page">
      <SectionHeader
        eyebrow="Cơ hội"
        title="Cơ hội đang được phát hiện"
      />

      <DataPanel
        description=""
        title="Danh sách cơ hội"
      >
        <div className="mb-5 flex items-center gap-2 rounded-full border border-[color:var(--line)] bg-[var(--surface-soft)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted)] w-fit">
          <span
            className={`size-2 rounded-full ${
              realtimeStatus === "live"
                ? "bg-emerald-500"
                : realtimeStatus === "connecting"
                  ? "bg-amber-500"
                  : "bg-slate-400"
            }`}
          />
          {realtimeStatus === "live"
            ? "Đang nhận dữ liệu"
            : realtimeStatus === "connecting"
              ? "Đang kết nối"
              : "Đang kết nối"}        </div>

        <QueryShell<Opportunity[]> {...query}>
          {(items) => (
            <div className="grid gap-4">
              {items.length === 0 ? (
                <div className="rounded-[28px] border border-dashed border-[color:var(--line)] bg-[var(--surface-soft)] px-6 py-10 text-center">
                  <p className="font-semibold text-[var(--ink)]">
                    Chưa có cơ hội đang còn hiệu lực
                  </p>
                  <p className="mx-auto mt-2 max-w-xl text-sm text-[var(--muted)]">
                    Màn hình vẫn đang nhận dữ liệu quét. Khi có cặp tỷ lệ tạo ra lợi thế,
                    hệ thống sẽ cập nhật ở đây.
                  </p>
                </div>
              ) : null}

              {items.map((row) => (
                <OpportunityCard key={row.id} row={row} />
              ))}
            </div>
          )}
        </QueryShell>
      </DataPanel>
    </div>
  );
}

function OpportunityCard({ row }: { row: Opportunity }) {
  const presentation = deriveOpportunityPresentation(row);

  return (
    <article className="overflow-hidden rounded-[28px] border border-[rgba(255,255,255,0.08)] bg-[linear-gradient(180deg,#23262f_0%,#1a1d24_100%)] p-5 text-white shadow-[0_20px_40px_rgba(15,31,38,0.2)]">
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <span className="rounded-full bg-[#f2c94c] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-[#5a4600]">
            {formatFreshness(row.detected_at)}
          </span>
          <div className="flex flex-col items-end gap-2">
            <span className="rounded-full bg-[#3199ff] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-white">
              Lệch tiền {presentation.moneyGap.toFixed(2)}
            </span>
            <span className="text-xs font-semibold text-[rgba(255,255,255,0.68)]">
              Lãi surebet {row.profit_percentage.toFixed(2)}%
            </span>
          </div>
        </div>

        <div className="space-y-2 text-center">
          <p className="text-lg font-semibold text-white">{row.fixture_id}</p>
          <p className="text-sm text-[rgba(255,255,255,0.82)]">
            {presentation.marketLabel}
          </p>
          <p className="text-xs uppercase tracking-[0.16em] text-[rgba(255,255,255,0.58)]">
            Hết hạn {formatTime(row.expires_at)}
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {presentation.legs.map((leg, index) => (
            <div
              className="rounded-[22px] border border-[rgba(255,255,255,0.16)] bg-[rgba(255,255,255,0.03)] p-4"
              key={`${row.id}-${leg.outcome_id}-${index}`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-lg font-bold text-white">
                  {leg.bookmaker_id} / {leg.lobby_id}
                </p>
                <span className="rounded-full bg-[#3199ff] px-2.5 py-1 text-[11px] font-bold text-white">
                  {formatMoneyOdds(leg.moneyOdds)}
                </span>
              </div>

              <div className="mt-4 space-y-2 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[rgba(255,255,255,0.78)]">Cửa đối ứng</span>
                  <span className="max-w-[65%] truncate text-right font-semibold text-white">
                    {leg.displayOutcome}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[rgba(255,255,255,0.78)]">Tỷ trọng vốn</span>
                  <span className="font-semibold text-white">
                    {(leg.stake * 100).toFixed(2)}%
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[rgba(255,255,255,0.58)]">Odds gốc</span>
                  <span className="text-[rgba(255,255,255,0.78)]">
                    {leg.odds.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </article>
  );
}

function formatFreshness(value: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) {
    return `${seconds} giây trước`;
  }
  return `${Math.floor(seconds / 60)} phút trước`;
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function deriveOpportunityPresentation(row: Opportunity) {
  const legs = row.legs.slice(0, 2).map((leg) => {
    const moneyOdds = convertToMoneyOdds(leg.bookmaker_id, leg.odds);
    return {
      ...leg,
      moneyOdds,
      displayOutcome: deriveOutcomeDisplayLabel(leg, row)
    };
  });

  const moneyGap =
    legs.length >= 2
      ? Math.abs(Math.abs(legs[0].moneyOdds) - Math.abs(legs[1].moneyOdds))
      : 0;

  return {
    marketLabel: deriveMarketDisplayLabel(row),
    moneyGap,
    legs
  };
}

function deriveMarketDisplayLabel(row: Opportunity) {
  const marketKind = detectMarketKind(row);
  const line = resolvePrimaryLine(row);

  if (marketKind === "over_under" && line) {
    return `Tài/Xỉu ${normalizeLineForDisplay(line)}`;
  }
  if (marketKind === "handicap" && line) {
    return `Kèo chấp ${normalizeHandicapLineForDisplay(line)}`;
  }
  if (marketKind === "one_x_two") {
    return "1X2";
  }

  return beautifyRawText(row.market_name || "Kèo đối ứng");
}

function deriveOutcomeDisplayLabel(
  leg: Opportunity["legs"][number],
  row: Opportunity
) {
  const marketKind = detectMarketKind(row);
  const line = resolvePrimaryLine(row);
  const normalized = canonicalText(leg.outcome_name);

  if (marketKind === "over_under") {
    if (containsOneOf(normalized, ["over", "tai"])) {
      return line ? `Tài ${normalizeLineForDisplay(line)}` : "Tài";
    }
    if (containsOneOf(normalized, ["under", "xiu"])) {
      return line ? `Xỉu ${normalizeLineForDisplay(line)}` : "Xỉu";
    }
  }

  if (marketKind === "one_x_two") {
    if (containsOneOf(normalized, ["draw", "hoa"])) {
      return "Hòa";
    }
  }

  return beautifyOutcomeName(leg.outcome_name);
}

function detectMarketKind(row: Opportunity) {
  const combined = canonicalText(
    [row.market_name, ...row.legs.map((leg) => leg.outcome_name)].join(" ")
  );

  if (
    containsOneOf(combined, ["over under", "over", "under", "tai", "xiu", "o u"])
  ) {
    return "over_under" as const;
  }

  if (containsOneOf(combined, ["handicap", "chap"])) {
    return "handicap" as const;
  }

  if (containsOneOf(combined, ["1x2", "draw", "hoa"])) {
    return "one_x_two" as const;
  }

  if (row.legs.some((leg) => extractLine(leg.outcome_name) !== "")) {
    return "handicap" as const;
  }

  return "unknown" as const;
}

function resolvePrimaryLine(row: Opportunity) {
  return row.legs
    .map((leg) => extractLine(leg.outcome_name))
    .find((value) => value !== "") ?? "";
}

function extractLine(value: string) {
  const match = value.trim().match(/([+-]?\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)?)$/);
  return match?.[1] ?? "";
}

function convertToMoneyOdds(bookmakerID: string, rawOdds: number) {
  if (!Number.isFinite(rawOdds)) {
    return 0;
  }

  if (bookmakerID === "8xbet") {
    return roundMoneyOdds(decimalToMalayOdds(rawOdds));
  }

  return roundMoneyOdds(rawOdds);
}

function decimalToMalayOdds(decimalOdds: number) {
  if (!Number.isFinite(decimalOdds) || decimalOdds <= 0) {
    return 0;
  }

  if (decimalOdds >= 2) {
    return -(1 / (decimalOdds - 1));
  }

  return decimalOdds - 1;
}

function roundMoneyOdds(value: number) {
  return Math.round(value * 100) / 100;
}

function formatMoneyOdds(value: number) {
  const rounded = roundMoneyOdds(value);
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(2)}`;
}

function normalizeLineForDisplay(value: string) {
  return value.trim().replace(/^\+/, "");
}

function normalizeHandicapLineForDisplay(value: string) {
  return normalizeLineForDisplay(value).replace(/^-/, "");
}

function beautifyOutcomeName(value: string) {
  return value
    .replace(/\s+/g, " ")
    .replace(/Away Goal O\/UAway Goal O\/U ov\s+/i, "")
    .replace(/Home Goal O\/UHome Goal O\/U ov\s+/i, "")
    .trim();
}

function beautifyRawText(value: string) {
  return value
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function containsOneOf(value: string, patterns: string[]) {
  return patterns.some((pattern) => value.includes(pattern));
}
