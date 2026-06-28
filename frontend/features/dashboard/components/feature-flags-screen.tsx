"use client";

import { Badge } from "@/components/ui/badge";
import { DataPanel } from "@/components/dashboard/data-panel";
import { SectionHeader } from "@/components/dashboard/section-header";
import { QueryShell } from "@/features/dashboard/components/query-shell";
import { useFeatureFlagsQuery } from "@/features/dashboard/queries/use-crm-queries";
import type { FeatureFlag } from "@/features/dashboard/schemas/crm-schemas";

export function FeatureFlagsScreen() {
  const query = useFeatureFlagsQuery();

  return (
    <div className="dashboard-page">
      <SectionHeader
        eyebrow="Feature flags"
        title="Điều khiển tính năng runtime"
        description="Trang này là điểm đặt cho admin control, audit và scope-level override."
      />

      <DataPanel
        title="Các flag đang áp dụng"
        description="Mỗi flag có thể được mở rộng theo scope global, bookmaker, lobby hoặc account."
      >
        <QueryShell<FeatureFlag[]> {...query}>
          {(items) => (
            <div className="space-y-3">
              {items.map((item) => (
                <div
                  className="flex items-start justify-between gap-4 rounded-[20px] border border-[color:var(--line)] bg-[var(--surface-soft)] px-4 py-4"
                  key={item.name}
                >
                  <div>
                    <p className="font-semibold">{item.name}</p>
                    <p className="mt-1 text-sm text-[var(--muted)]">Phạm vi: {item.scope}</p>
                  </div>
                  <Badge variant={item.value === "ON" ? "teal" : "red"}>
                    {item.value === "ON" ? "BẬT" : "TẮT"}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </QueryShell>
      </DataPanel>
    </div>
  );
}
