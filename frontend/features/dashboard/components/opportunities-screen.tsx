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
        eyebrow="Opportunities"
        title="Danh sach surebet hien tai"
        description="Trang nay dung TanStack Query cho du lieu va Zustand cho view-mode cua operator."
      />

      <DataPanel
        title="Bang co hoi"
        description="Loc nhanh theo do uu tien ma khong can day state xuong qua nhieu tang component."
      >
        <div className="space-y-5">
          <div className="flex flex-wrap gap-2">
            {[
              { label: "Tat ca", value: "all" },
              { label: "Loi nhuan cao", value: "high-profit" },
              { label: "Moi cap nhat", value: "fresh" }
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
                          item.freshness.includes("8s") ||
                          item.freshness.includes("11s")
                      )
                    : items;

              return (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] border-separate border-spacing-y-3 text-left">
                    <thead>
                      <tr className="text-xs uppercase tracking-[0.16em] text-slate-400">
                        <th className="pb-2 font-medium">Fixture</th>
                        <th className="pb-2 font-medium">Market</th>
                        <th className="pb-2 font-medium">Profit</th>
                        <th className="pb-2 font-medium">Spread</th>
                        <th className="pb-2 font-medium">Freshness</th>
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
