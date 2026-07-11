"use client";

import { DataPanel } from "@/components/dashboard/data-panel";
import { SectionHeader } from "@/components/dashboard/section-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { QueryShell } from "@/features/dashboard/components/query-shell";
import { useDashboardSnapshotQuery } from "@/features/dashboard/queries/use-crm-queries";
import type { DashboardSnapshot } from "@/features/dashboard/schemas/crm-schemas";

export function DashboardOverviewScreen() {
  const query = useDashboardSnapshotQuery();

  return (
    <div className="dashboard-page">
      <SectionHeader
        eyebrow="Tổng quan"
        title="Các cơ hội mới nhất"
      />

      <QueryShell<DashboardSnapshot> {...query}>
        {(snapshot) => (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {snapshot.stats.map((card) => (
                <StatCard key={card.title} {...card} />
              ))}
            </div>

            <div className="mt-4">
              <DataPanel
                title="Cơ hội hiện tại"
                description=""
              >
                {snapshot.opportunities.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px] border-separate border-spacing-y-3 text-left">
                      <thead>
                        <tr className="text-xs uppercase tracking-[0.16em] text-slate-400">
                          <th className="pb-2 font-medium">Trận đấu</th>
                          <th className="pb-2 font-medium">Loại kèo</th>
                          <th className="pb-2 font-medium">Lợi nhuận</th>
                          <th className="pb-2 font-medium">Dự kiến</th>
                          <th className="pb-2 font-medium">Hai cửa</th>
                          <th className="pb-2 font-medium">Phát hiện</th>
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
                            <td className="px-4 py-4">
                              {(row.expected_return * 100).toFixed(2)}%
                            </td>
                            <td className="px-4 py-4">
                              {row.legs
                                .map((leg) => `${leg.bookmaker_id}/${leg.lobby_id}`)
                                .join(" và ")}
                            </td>
                            <td className="rounded-r-[20px] px-4 py-4 text-slate-500">
                              {formatFreshness(row.detected_at)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="rounded-[20px] border border-dashed border-[color:var(--line)] px-5 py-8 text-sm text-[var(--muted)]">
                    Chưa có kèo.
                  </div>
                )}
              </DataPanel>
            </div>
          </>
        )}
      </QueryShell>
    </div>
  );
}

function formatFreshness(value: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) {
    return `${seconds} giây trước`;
  }
  return `${Math.floor(seconds / 60)} phút trước`;
}
