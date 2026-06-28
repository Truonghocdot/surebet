"use client";

import { DataPanel } from "@/components/dashboard/data-panel";
import { SectionHeader } from "@/components/dashboard/section-header";
import { QueryShell } from "@/features/dashboard/components/query-shell";
import { useOrdersQuery } from "@/features/dashboard/queries/use-crm-queries";
import type { Order } from "@/features/dashboard/schemas/crm-schemas";

export function OrdersScreen() {
  const query = useOrdersQuery();

  return (
    <div className="dashboard-page">
      <SectionHeader
        eyebrow="Lệnh cược"
        title="Vòng đời lệnh đặt cược"
        description="Mốc state machine hiện tại sẵn sàng để thay bằng API thật sau khi backend có order endpoint."
      />

      <DataPanel
        title="Lệnh gần đây"
        description="Execution lifecycle được biểu diễn rõ ràng để tránh state ambiguity."
      >
        <QueryShell<Order[]> {...query}>
          {(items) => (
            <div className="space-y-3">
              {items.map((item) => (
                <div
                  className="flex items-start justify-between gap-4 rounded-[20px] border border-[color:var(--line)] bg-[var(--surface-soft)] px-4 py-4"
                  key={item.id}
                >
                  <div>
                    <p className="font-semibold">{item.id}</p>
                    <p className="mt-1 text-sm text-[var(--muted)]">{item.operator}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">{item.state}</p>
                    <p className="mt-1 text-sm text-[var(--muted)]">{item.updatedAt}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </QueryShell>
      </DataPanel>
    </div>
  );
}
