"use client";

import { Button } from "@/components/ui/button";
import { DataPanel } from "@/components/dashboard/data-panel";
import { SectionHeader } from "@/components/dashboard/section-header";
import { QueryShell } from "@/features/dashboard/components/query-shell";
import {
  useOpportunitiesQuery,
  useOpportunitiesStream
} from "@/features/dashboard/queries/use-crm-queries";
import type { Opportunity } from "@/features/dashboard/schemas/crm-schemas";
import { useOpportunityViewStore } from "@/features/dashboard/store/opportunity-view-store";

export function OpportunitiesScreen() {
  const query = useOpportunitiesQuery();
  const streamStatus = useOpportunitiesStream();
  const mode = useOpportunityViewStore((state) => state.mode);
  const setMode = useOpportunityViewStore((state) => state.setMode);

  return (
    <div className="dashboard-page">
      <SectionHeader
        eyebrow="Cơ hội"
        title="Danh sách surebet hiện tại"
        description=""
      />

      <DataPanel
        title="Bảng surebet trực tiếp"
        description="Dữ liệu lấy trực tiếp từ backend detector. Tập trung vào cơ hội đang sống, mức lợi nhuận và cấu trúc 2 chân cược."
      >
        <div className="space-y-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap gap-2">
              {[
                { label: "Tất cả", value: "all" },
                { label: "Lợi nhuận cao", value: "high-profit" },
                { label: "Mới cập nhật", value: "fresh" }
              ].map((item) => (
                <Button
                  className="min-w-[140px]"
                  key={item.value}
                  onClick={() => setMode(item.value as "all" | "high-profit" | "fresh")}
                  type="button"
                  variant={mode === item.value ? "primary" : "secondary"}
                >
                  {item.label}
                </Button>
              ))}
            </div>

            <div className="flex items-center gap-2 rounded-full border border-[color:var(--line)] bg-[var(--surface-soft)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">
              <span
                className={`size-2 rounded-full ${
                  streamStatus === "live"
                    ? "bg-emerald-500"
                    : streamStatus === "connecting"
                      ? "bg-amber-500"
                      : "bg-slate-400"
                }`}
              />
              {streamStatus === "live"
                ? "Stream live"
                : streamStatus === "connecting"
                  ? "Đang nối stream"
                  : "Polling fallback"}
            </div>
          </div>

          <QueryShell<Opportunity[]> {...query}>
            {(items) => {
              const filtered =
                mode === "high-profit"
                  ? items.filter((item) => item.profit_percentage >= 2.3)
                  : mode === "fresh"
                    ? items.filter(
                        (item) => ageInSeconds(item.detected_at) <= 15
                      )
                    : items;

              return (
                <div className="grid gap-4">
                  {filtered.length === 0 ? (
                    <div className="rounded-[28px] border border-dashed border-[color:var(--line)] bg-[var(--surface-soft)] px-6 py-10 text-center">
                      <p className="font-semibold text-[var(--ink)]">
                        Chưa có surebet đang sống
                      </p>
                      <p className="mx-auto mt-2 max-w-xl text-sm text-[var(--muted)]">
                        Stream vẫn đang nghe backend. Khi detector phát hiện cặp cùng trận,
                        cùng market/line và đủ lợi nhuận, bảng này sẽ tự cập nhật.
                      </p>
                    </div>
                  ) : null}

                  {filtered.map((row) => (
                    <article
                      className="overflow-hidden rounded-[28px] border border-[rgba(255,255,255,0.08)] bg-[linear-gradient(180deg,#23262f_0%,#1a1d24_100%)] p-5 text-white shadow-[0_20px_40px_rgba(15,31,38,0.2)]"
                      key={row.id}
                    >
                      <div className="flex flex-col gap-4">
                        <div className="flex items-start justify-between gap-3">
                          <span className="rounded-full bg-[#f2c94c] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-[#5a4600]">
                            {formatFreshness(row.detected_at)}
                          </span>
                          <span className="rounded-full bg-[#2ecc71] px-3 py-1 text-[13px] font-bold text-white">
                            {row.profit_percentage.toFixed(2)}%
                          </span>
                        </div>

                        <div className="space-y-3 text-center">
                          <p className="text-lg font-semibold text-white">
                            {deriveFixtureTitle(row)}
                          </p>
                          <div className="flex items-center justify-center gap-3">
                            <span className="rounded-full bg-[#1e90ff] px-4 py-1 text-sm font-semibold text-white">
                              {deriveTeamLabel(row.legs[0]?.outcome_name, "Vế 1")}
                            </span>
                            <span className="rounded-full bg-[rgba(255,255,255,0.14)] px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-white">
                              VS
                            </span>
                            <span className="rounded-full bg-[#1e90ff] px-4 py-1 text-sm font-semibold text-white">
                              {deriveTeamLabel(row.legs[1]?.outcome_name, "Vế 2")}
                            </span>
                          </div>
                          <p className="text-xs text-[rgba(255,255,255,0.6)]">
                            Fixture: {row.fixture_id} · Hết hạn {formatTime(row.expires_at)}
                          </p>
                        </div>

                        <div className="grid gap-4 lg:grid-cols-2">
                          {row.legs.slice(0, 2).map((leg, index) => (
                            <div
                              className="rounded-[22px] border border-[rgba(255,255,255,0.16)] bg-[rgba(255,255,255,0.03)] p-4"
                              key={`${row.id}-${leg.outcome_id}-${index}`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <p
                                  className={`text-lg font-bold ${
                                    index === 0 ? "text-[#ff5a5f]" : "text-[#8df26c]"
                                  }`}
                                >
                                  {formatBookmaker(leg.bookmaker_id)}
                                </p>
                                <div className="flex flex-wrap items-center gap-2 justify-end">
                                  <span className="rounded-full bg-[#f2c94c] px-2.5 py-1 text-[11px] font-bold uppercase text-[#5a4600]">
                                    {formatMarket(row.market_name)}
                                  </span>
                                  <span className="rounded-full bg-[#3199ff] px-2.5 py-1 text-[11px] font-bold text-white">
                                    {deriveLine(leg.outcome_name) || "-"}
                                  </span>
                                </div>
                              </div>

                              <div className="mt-4 space-y-2 text-sm">
                                <div className="flex items-center justify-between gap-3">
                                  <span className="text-[rgba(255,255,255,0.78)]">Selection</span>
                                  <span className="max-w-[65%] truncate text-right font-semibold text-white">
                                    {leg.outcome_name}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between gap-3">
                                  <span className="text-[rgba(255,255,255,0.78)]">Odds</span>
                                  <span className="rounded-full bg-[#ff4d6d] px-2.5 py-1 text-sm font-bold text-white">
                                    {formatOdds(leg.odds)}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between gap-3">
                                  <span className="text-[rgba(255,255,255,0.78)]">Stake</span>
                                  <span className="font-semibold text-white">
                                    {(leg.stake * 100).toFixed(2)}%
                                  </span>
                                </div>
                                <div className="flex items-center justify-between gap-3">
                                  <span className="text-[rgba(255,255,255,0.78)]">Lobby</span>
                                  <span className="font-semibold uppercase text-white">
                                    {leg.lobby_id}
                                  </span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>

                        <div className="grid gap-3 rounded-[22px] bg-[rgba(255,255,255,0.04)] p-4 lg:grid-cols-2">
                          <Metric
                            label="Expected return"
                            value={row.expected_return.toFixed(4)}
                            tone="neutral"
                          />
                          <Metric
                            label="Số chân cược"
                            value={String(row.legs.length)}
                            tone="neutral"
                          />
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              );
            }}
          </QueryShell>
        </div>
      </DataPanel>
    </div>
  );
}

function Metric({
  label,
  value,
  tone
}: {
  label: string;
  value: string;
  tone: "profit" | "neutral";
}) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">
        {label}
      </p>
      <p
        className={`mt-1 text-xl font-semibold ${
          tone === "profit" ? "text-[#2ecc71]" : "text-white"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function formatFreshness(detectedAt: string) {
  const seconds = ageInSeconds(detectedAt);
  if (seconds < 60) {
    return `${seconds}s trước`;
  }

  const minutes = Math.floor(seconds / 60);
  return `${minutes} phút trước`;
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function ageInSeconds(value: string) {
  return Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
}

function deriveFixtureTitle(row: Opportunity) {
  const left = deriveTeamLabel(row.legs[0]?.outcome_name, "");
  const right = deriveTeamLabel(row.legs[1]?.outcome_name, "");
  if (left && right && left !== right) {
    return `${left} vs ${right}`;
  }
  return row.fixture_id;
}

function deriveTeamLabel(outcomeName: string | undefined, fallback: string) {
  if (!outcomeName) {
    return fallback;
  }

  const line = deriveLine(outcomeName);
  const stripped = line
    ? outcomeName.replace(new RegExp(`\\s*${escapeForRegExp(line)}$`), "").trim()
    : outcomeName.trim();

  return stripped || fallback;
}

function deriveLine(outcomeName: string | undefined) {
  if (!outcomeName) {
    return "";
  }

  const match = outcomeName.match(/([+-]?\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)?)$/);
  return match?.[1] ?? "";
}

function formatBookmaker(value: string) {
  return value.replace(/^\w/, (char) => char.toUpperCase());
}

function formatMarket(value: string) {
  const normalized = value.toLowerCase();
  if (normalized.includes("handicap") || normalized.includes("chấp")) {
    return "Cược chấp";
  }
  if (normalized.includes("over") || normalized.includes("tài")) {
    return "Tài xỉu";
  }
  return value;
}

function formatOdds(value: number) {
  return value.toFixed(2).replace(/\.00$/, "");
}

function escapeForRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
