"use client";

import { DataPanel } from "@/components/dashboard/data-panel";
import { SectionHeader } from "@/components/dashboard/section-header";
import { QueryShell } from "@/features/dashboard/components/query-shell";
import { useAccountsQuery } from "@/features/dashboard/queries/use-crm-queries";
import type { Account } from "@/features/dashboard/schemas/crm-schemas";

export function AccountsScreen() {
  const query = useAccountsQuery();

  return (
    <div className="dashboard-page">
      <SectionHeader
        eyebrow="Accounts"
        title="Quan ly account bookmaker"
        description="Server-state cua account readiness duoc cache bang TanStack Query de tranh duplicate fetch."
      />

      <DataPanel
        title="Tinh trang account"
        description="Scaffold nay san sang de thay bang API response va websocket updates."
      >
        <QueryShell<Account[]> {...query}>
          {(items) => (
            <div className="space-y-3">
              {items.map((item) => (
                <div
                  className="flex items-start justify-between gap-4 rounded-[20px] border border-[color:var(--line)] bg-[var(--surface-soft)] px-4 py-4"
                  key={`${item.bookmaker}-${item.account}`}
                >
                  <div>
                    <p className="font-semibold">{item.account}</p>
                    <p className="mt-1 text-sm text-[var(--muted)]">{item.bookmaker}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">{item.balance}</p>
                    <p
                      className={
                        item.status === "ACTIVE"
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
          )}
        </QueryShell>
      </DataPanel>
    </div>
  );
}
