"use client";

import { DataPanel } from "@/components/dashboard/data-panel";
import { SectionHeader } from "@/components/dashboard/section-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { QueryShell } from "@/features/dashboard/components/query-shell";
import { useDashboardSnapshotQuery } from "@/features/dashboard/queries/use-crm-queries";
import type {
  DashboardSnapshot,
  FeedSource,
  OddsRow
} from "@/features/dashboard/schemas/crm-schemas";

export function DashboardOverviewScreen() {
  const query = useDashboardSnapshotQuery();

  return (
    <div className="dashboard-page">
      <SectionHeader
        eyebrow="Tổng quan"
        title="Scraping và so sánh odds"
        description="Dashboard này chỉ tập trung vào feed scrape hiện tại, dữ liệu odds vừa thu thập và các cơ hội surebet được phát hiện từ phép so sánh đó."
      />

      <QueryShell<DashboardSnapshot> {...query}>
        {(snapshot) => (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {snapshot.stats.map((card) => (
                <StatCard key={card.title} {...card} />
              ))}
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-12">
              <div className="xl:col-span-5">
                <DataPanel
                  title="Nguồn feed scrape"
                  description="Theo dõi trạng thái từng nguồn scrape theo bookmaker và lobby."
                >
                  <div className="space-y-3">
                    {snapshot.feeds.map((item) => (
                      <FeedCard key={item.source_id} item={item} />
                    ))}
                  </div>
                </DataPanel>
              </div>

              <div className="xl:col-span-7">
                <DataPanel
                  title="Surebet mới nhất"
                  description="Các cơ hội được detector phát hiện từ dữ liệu odds hiện tại."
                >
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] border-separate border-spacing-y-3 text-left">
                      <thead>
                        <tr className="text-xs uppercase tracking-[0.16em] text-slate-400">
                          <th className="pb-2 font-medium">Fixture</th>
                          <th className="pb-2 font-medium">Market</th>
                          <th className="pb-2 font-medium">Profit</th>
                          <th className="pb-2 font-medium">Legs</th>
                          <th className="pb-2 font-medium">Detected</th>
                        </tr>
                      </thead>
                      <tbody>
                        {snapshot.opportunities.map((row) => (
                          <tr
                            className="bg-[var(--surface-soft)] text-sm text-[var(--ink)] shadow-[inset_0_0_0_1px_var(--line)]"
                            key={row.id}
                          >
                            <td className="rounded-l-[20px] px-4 py-4 font-medium">
                              {row.fixture_id}
                            </td>
                            <td className="px-4 py-4">{row.market_name}</td>
                            <td className="px-4 py-4 text-teal-700">
                              {row.profit_percentage.toFixed(2)}%
                            </td>
                            <td className="px-4 py-4">{row.legs.length}</td>
                            <td className="rounded-r-[20px] px-4 py-4 text-slate-500">
                              {formatFreshness(row.detected_at)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </DataPanel>
              </div>

              <div className="xl:col-span-12">
                <DataPanel
                  title="Odds vừa scrape"
                  description="Những bản ghi odds mới nhất đang được backend dùng để so sánh và tìm surebet."
                >
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[920px] border-separate border-spacing-y-3 text-left">
                      <thead>
                        <tr className="text-xs uppercase tracking-[0.16em] text-slate-400">
                          <th className="pb-2 font-medium">Nguồn</th>
                          <th className="pb-2 font-medium">Fixture</th>
                          <th className="pb-2 font-medium">Market</th>
                          <th className="pb-2 font-medium">Selection</th>
                          <th className="pb-2 font-medium">Odds</th>
                          <th className="pb-2 font-medium">Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {snapshot.odds.map((row, index) => (
                          <OddsRowEntry key={`${row.bookmaker_id}-${row.outcome_name}-${index}`} row={row} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                </DataPanel>
              </div>
            </div>
          </>
        )}
      </QueryShell>
    </div>
  );
}

function FeedCard({ item }: { item: FeedSource }) {
  return (
    <div className="rounded-[20px] border border-[color:var(--line)] bg-[var(--surface-soft)] px-4 py-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-semibold uppercase">
            {item.bookmaker_id} / {item.lobby_id}
          </p>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {item.fixtures} fixtures · {item.live_odds} odds sống
          </p>
        </div>
        <p className={feedStatusClass(item.status)}>{item.status}</p>
      </div>
      <p className="mt-3 text-xs text-[var(--muted)]">
        Lần scrape gần nhất: {item.latest_seen_at ? formatDateTime(item.latest_seen_at) : "chưa có"}
      </p>
    </div>
  );
}

function OddsRowEntry({ row }: { row: OddsRow }) {
  return (
    <tr className="bg-[var(--surface-soft)] text-sm text-[var(--ink)] shadow-[inset_0_0_0_1px_var(--line)]">
      <td className="rounded-l-[20px] px-4 py-4 font-medium uppercase">
        {row.bookmaker_id} / {row.lobby_id}
      </td>
      <td className="px-4 py-4">
        <p className="font-medium">{row.match_name || row.fixture_id}</p>
        <p className="mt-1 text-xs text-[var(--muted)]">{row.period || "FT"}</p>
      </td>
      <td className="px-4 py-4">
        {[row.market_type, row.line].filter(Boolean).join(" ").trim() || row.market_type}
      </td>
      <td className="px-4 py-4">{row.outcome_name}</td>
      <td className="px-4 py-4">
        <span className="font-semibold">{row.odds.toFixed(2)}</span>
        <span className="ml-2 text-xs text-[var(--muted)]">
          dec {row.decimal_odds.toFixed(2)}
        </span>
      </td>
      <td className="rounded-r-[20px] px-4 py-4 text-slate-500">
        {formatDateTime(row.collected_at)}
      </td>
    </tr>
  );
}

function feedStatusClass(status: string) {
  switch (status) {
    case "LIVE":
      return "text-sm font-semibold text-teal-700";
    case "STALE":
      return "text-sm font-semibold text-orange-700";
    default:
      return "text-sm font-semibold text-slate-500";
  }
}

function formatFreshness(value: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) {
    return `${seconds}s trước`;
  }
  return `${Math.floor(seconds / 60)} phút trước`;
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    day: "2-digit",
    month: "2-digit"
  });
}
