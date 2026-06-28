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
        title="Dashboard vận hành thời gian thực"
        description="Góc nhìn tổng hợp về cơ hội surebet, trạng thái lệnh, tài khoản bookmaker và các feature flag đang ảnh hưởng tới hệ thống."
      />

      <QueryShell<DashboardSnapshot> {...query}>
        {(snapshot) => (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {snapshot.stats.map((card) => (
                <StatCard key={card.title} {...card} />
              ))}
            </div>

            <div className="grid gap-4 xl:grid-cols-12">
              <div className="xl:col-span-7">
                <DataPanel
                  title="Surebet đang được ưu tiên"
                  description="Những cơ hội mới nhất đang có lợi nhuận đủ ngưỡng và cần tiếp tục theo dõi."
                >
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] border-separate border-spacing-y-3 text-left">
                      <thead>
                        <tr className="text-xs uppercase tracking-[0.16em] text-slate-400">
                          <th className="pb-2 font-medium">Trận đấu</th>
                          <th className="pb-2 font-medium">Market</th>
                          <th className="pb-2 font-medium">Lợi nhuận</th>
                          <th className="pb-2 font-medium">Spread</th>
                          <th className="pb-2 font-medium">Độ mới</th>
                        </tr>
                      </thead>
                      <tbody>
                        {snapshot.opportunities.map((row) => (
                          <tr
                            className="bg-[var(--surface-soft)] text-sm text-[var(--ink)] shadow-[inset_0_0_0_1px_var(--line)]"
                            key={row.fixture}
                          >
                            <td className="rounded-l-[20px] px-4 py-4 font-medium">
                              {row.fixture}
                            </td>
                            <td className="px-4 py-4">{row.market}</td>
                            <td className="px-4 py-4 text-teal-700">{row.profit}</td>
                            <td className="px-4 py-4">{row.spread}</td>
                            <td className="rounded-r-[20px] px-4 py-4 text-slate-500">
                              {row.freshness}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </DataPanel>
              </div>

              <div className="xl:col-span-5">
                <DataPanel
                  title="Tiến trình lệnh cược"
                  description="Trạng thái cập nhật của những lệnh gần đây theo state machine."
                >
                  <div className="space-y-3">
                    {snapshot.orders.map((item) => (
                      <div
                        className="flex items-start justify-between gap-4 rounded-[20px] border border-[color:var(--line)] bg-[var(--surface-soft)] px-4 py-4"
                        key={item.id}
                      >
                        <div>
                          <p className="font-semibold">{item.id}</p>
                          <p className="mt-1 text-sm text-[var(--muted)]">
                            {item.operator}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold">{item.state}</p>
                          <p className="mt-1 text-sm text-[var(--muted)]">
                            {item.updatedAt}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </DataPanel>
              </div>

              <div className="xl:col-span-7">
                <DataPanel
                  title="Tình trạng account"
                  description="Theo dõi balance, session và độ sẵn sàng của các account bookmaker."
                >
                  <div className="space-y-3">
                    {snapshot.accounts.map((item) => (
                      <div
                        className="flex items-start justify-between gap-4 rounded-[20px] border border-[color:var(--line)] bg-[var(--surface-soft)] px-4 py-4"
                        key={`${item.bookmaker}-${item.account}`}
                      >
                        <div>
                          <p className="font-semibold">{item.account}</p>
                          <p className="mt-1 text-sm text-[var(--muted)]">
                            {item.bookmaker}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold">{item.balance}</p>
                          <p
                            className={
                              item.status === "Hoạt động"
                                ? "mt-1 text-sm text-teal-700"
                                : "mt-1 text-sm text-orange-700"
                            }
                          >
                            {item.status}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </DataPanel>
              </div>

              <div className="xl:col-span-5">
                <DataPanel
                  title="Feature flag runtime"
                  description="Những công tắc hiện đang ảnh hưởng đến execution và validation."
                >
                  <div className="space-y-3">
                    {snapshot.flags.map((item) => (
                      <div
                        className="flex items-start justify-between gap-4 rounded-[20px] border border-[color:var(--line)] bg-[var(--surface-soft)] px-4 py-4"
                        key={item.name}
                      >
                        <div>
                          <p className="font-semibold">{item.name}</p>
                          <p className="mt-1 text-sm text-[var(--muted)]">
                            Phạm vi: {item.scope}
                          </p>
                        </div>
                        <p
                          className={
                            item.value === "ON"
                              ? "font-semibold text-teal-700"
                              : "font-semibold text-red-700"
                          }
                        >
                          {item.value === "ON" ? "BẬT" : "TẮT"}
                        </p>
                      </div>
                    ))}
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
