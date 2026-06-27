"use client";

import { Badge } from "@/components/ui/badge";
import { DataPanel } from "@/components/dashboard/data-panel";
import { SectionHeader } from "@/components/dashboard/section-header";
import { QueryShell } from "@/features/dashboard/components/query-shell";
import { useRiskCheckpointsQuery } from "@/features/dashboard/queries/use-crm-queries";
import type { RiskCheckpoint } from "@/features/dashboard/schemas/crm-schemas";

export function RiskScreen() {
  const query = useRiskCheckpointsQuery();

  return (
    <div className="dashboard-page">
      <SectionHeader
        eyebrow="Risk"
        title="Risk va validation control"
        description="Checkpoint duoc parse bang Zod truoc khi vao UI, giup page nay on dinh khi doi nguon du lieu sau nay."
      />

      <DataPanel
        title="Pipeline checkpoints"
        description="Cac checkpoint nay phu hop voi validation order da dinh nghia o backend."
      >
        <QueryShell<RiskCheckpoint[]> {...query}>
          {(items) => (
            <div className="space-y-3">
              {items.map((item) => (
                <div
                  className="flex items-center justify-between gap-4 rounded-[20px] border border-[color:var(--line)] bg-[var(--surface-soft)] px-4 py-4"
                  key={item.label}
                >
                  <p className="font-semibold">{item.label}</p>
                  <Badge
                    variant={
                      item.status === "active"
                        ? "teal"
                        : item.status === "watch"
                          ? "orange"
                          : "red"
                    }
                  >
                    {item.status}
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
