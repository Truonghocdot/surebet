"use client";

import { DataPanel } from "@/components/dashboard/data-panel";
import { SectionHeader } from "@/components/dashboard/section-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { QueryShell } from "@/features/dashboard/components/query-shell";
import { useDashboardSnapshotQuery } from "@/features/dashboard/queries/use-crm-queries";
import type {
  DashboardSnapshot,
  Opportunity
} from "@/features/dashboard/schemas/crm-schemas";

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
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {snapshot.stats.map((card) => (
                <StatCard key={card.title} {...card} />
              ))}
            </div>

            <div className="mt-4">
              <DataPanel
                description=""
                title="Cơ hội hiện tại"
              >
                {snapshot.opportunities.length > 0 ? (
                  <>
                    <div className="grid gap-3 md:hidden">
                      {snapshot.opportunities.map((row) => (
                        <OverviewOpportunityCard key={row.id} row={row} />
                      ))}
                    </div>

                    <div className="hidden overflow-x-auto md:block">
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
                  </>
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

function OverviewOpportunityCard({ row }: { row: Opportunity }) {
  return (
    <article className="rounded-[22px] border border-[color:var(--line)] bg-[var(--surface-soft)] p-4 shadow-[inset_0_0_0_1px_var(--line)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
            Trận đấu
          </p>
          <p className="mt-1 break-words font-semibold leading-6 text-[var(--ink)]">
            {row.fixture_id}
          </p>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{row.market_name}</p>
        </div>
        <span className="shrink-0 rounded-full bg-teal-50 px-3 py-1 text-xs font-semibold text-teal-700">
          {row.profit_percentage.toFixed(2)}%
        </span>
      </div>

      <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <OverviewMetaField
          label="Dự kiến"
          value={`${(row.expected_return * 100).toFixed(2)}%`}
        />
        <OverviewMetaField label="Phát hiện" value={formatFreshness(row.detected_at)} />
        <OverviewMetaField
          className="sm:col-span-2"
          label="Hai cửa"
          value={row.legs
            .map((leg) => `${leg.bookmaker_id}/${leg.lobby_id}`)
            .join(" và ")}
        />
      </div>
    </article>
  );
}

function OverviewMetaField({
  label,
  value,
  className
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
        {label}
      </p>
      <p className="mt-1 break-words leading-6 text-[var(--ink)]">{value}</p>
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
