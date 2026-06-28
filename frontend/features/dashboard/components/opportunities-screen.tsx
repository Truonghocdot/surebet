"use client";

import { Button } from "@/components/ui/button";
import { DataPanel } from "@/components/dashboard/data-panel";
import { SectionHeader } from "@/components/dashboard/section-header";
import { QueryShell } from "@/features/dashboard/components/query-shell";
import { useOpportunitiesQuery } from "@/features/dashboard/queries/use-crm-queries";
import type { Opportunity } from "@/features/dashboard/schemas/crm-schemas";
import { useOpportunityViewStore } from "@/features/dashboard/store/opportunity-view-store";

export function OpportunitiesScreen() {
  const query = useOpportunitiesQuery();
  const mode = useOpportunityViewStore((state) => state.mode);
  const setMode = useOpportunityViewStore((state) => state.setMode);

  return (
    <div className="dashboard-page">
      <SectionHeader
        eyebrow="Cơ hội"
        title="Danh sách surebet hiện tại"
        description="Trang này dùng TanStack Query cho dữ liệu và Zustand cho view-mode của operator."
      />

      <DataPanel
        title="Bảng cơ hội"
        description="Lọc nhanh theo độ ưu tiên mà không cần đẩy state xuống quá nhiều tầng component."
      >
        <div className="space-y-5">
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

          <QueryShell<Opportunity[]> {...query}>
            {(items) => {
              const filtered =
                mode === "high-profit"
                  ? items.filter((item) => Number.parseFloat(item.profit) >= 2.3)
                  : mode === "fresh"
                    ? items.filter(
                        (item) =>
                          item.freshness.includes("8 giây") ||
                          item.freshness.includes("11 giây")
                      )
                    : items;

              return (
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
                      {filtered.map((row) => (
                        <tr
                          className="bg-[var(--surface-soft)] text-sm shadow-[inset_0_0_0_1px_var(--line)]"
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
              );
            }}
          </QueryShell>
        </div>
      </DataPanel>
    </div>
  );
}
