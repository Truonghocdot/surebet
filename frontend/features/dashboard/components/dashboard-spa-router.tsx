"use client";

import { DashboardOverviewScreen } from "@/features/dashboard/components/dashboard-overview-screen";
import { MatchedFixturesScreen } from "@/features/dashboard/components/matched-fixtures-screen";
import { OpportunitiesScreen } from "@/features/dashboard/components/opportunities-screen";
import { AdminTelegramRecipientsScreen } from "@/features/admin/components/admin-telegram-recipients-screen";
import type { DashboardHref } from "@/lib/dashboard-spa";

const views: Array<{
  href: DashboardHref;
  screen: React.ReactNode;
}> = [
  {
    href: "/dashboard",
    screen: <DashboardOverviewScreen />
  },
  {
    href: "/opportunities",
    screen: <OpportunitiesScreen />
  },
  {
    href: "/matches",
    screen: <MatchedFixturesScreen />
  },
  {
    href: "/admin",
    screen: <AdminTelegramRecipientsScreen />
  }
];

export function DashboardSpaRouter({ activeHref }: { activeHref: DashboardHref }) {
  return (
    <>
      {views.map((view) => (
        <section
          aria-hidden={activeHref !== view.href}
          className={activeHref === view.href ? "block" : "hidden"}
          key={view.href}
        >
          {view.screen}
        </section>
      ))}
    </>
  );
}
