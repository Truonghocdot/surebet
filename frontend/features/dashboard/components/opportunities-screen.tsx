"use client";

import { DataPanel } from "@/components/dashboard/data-panel";
import { SectionHeader } from "@/components/dashboard/section-header";
import { QueryShell } from "@/features/dashboard/components/query-shell";
import {
  useOpportunitiesQuery,
  useOpportunitiesStream
} from "@/features/dashboard/queries/use-crm-queries";
import type { Opportunity } from "@/features/dashboard/schemas/crm-schemas";

export function OpportunitiesScreen() {
  const query = useOpportunitiesQuery();
  const streamStatus = useOpportunitiesStream();

  return (
    <div className="dashboard-page">
      <SectionHeader
        eyebrow="Cơ hội"
        title="Surebet đang được phát hiện"
        description="Trang này chỉ hiển thị kết quả so sánh odds từ dữ liệu scrape hiện tại."
      />

      <DataPanel
        title="Danh sách cơ hội"
        description="Khi detector tìm thấy chênh lệch có lợi giữa các nguồn odds, kết quả sẽ xuất hiện ở đây."
      >
        <div className="mb-5 flex items-center gap-2 rounded-full border border-[color:var(--line)] bg-[var(--surface-soft)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted)] w-fit">
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

        <QueryShell<Opportunity[]> {...query}>
          {(items) => (
            <div className="grid gap-4">
              {items.length === 0 ? (
                <div className="rounded-[28px] border border-dashed border-[color:var(--line)] bg-[var(--surface-soft)] px-6 py-10 text-center">
                  <p className="font-semibold text-[var(--ink)]">
                    Chưa có surebet đang sống
                  </p>
                  <p className="mx-auto mt-2 max-w-xl text-sm text-[var(--muted)]">
                    Dashboard vẫn đang nghe feed scrape. Khi có cặp odds tạo ra lợi thế,
                    hệ thống sẽ cập nhật tại đây.
                  </p>
                </div>
              ) : null}

              {items.map((row) => (
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

                    <div className="space-y-2 text-center">
                      <p className="text-lg font-semibold text-white">{row.fixture_id}</p>
                      <p className="text-sm text-[rgba(255,255,255,0.7)]">
                        {row.market_name} · hết hạn {formatTime(row.expires_at)}
                      </p>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-2">
                      {row.legs.slice(0, 2).map((leg, index) => (
                        <div
                          className="rounded-[22px] border border-[rgba(255,255,255,0.16)] bg-[rgba(255,255,255,0.03)] p-4"
                          key={`${row.id}-${leg.outcome_id}-${index}`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-lg font-bold text-white">
                              {leg.bookmaker_id} / {leg.lobby_id}
                            </p>
                            <span className="rounded-full bg-[#3199ff] px-2.5 py-1 text-[11px] font-bold text-white">
                              {leg.odds.toFixed(2)}
                            </span>
                          </div>

                          <div className="mt-4 space-y-2 text-sm">
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-[rgba(255,255,255,0.78)]">Selection</span>
                              <span className="max-w-[65%] truncate text-right font-semibold text-white">
                                {leg.outcome_name}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-[rgba(255,255,255,0.78)]">Stake</span>
                              <span className="font-semibold text-white">
                                {(leg.stake * 100).toFixed(2)}%
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </QueryShell>
      </DataPanel>
    </div>
  );
}

function formatFreshness(value: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) {
    return `${seconds}s trước`;
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
