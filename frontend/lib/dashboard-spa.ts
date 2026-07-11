export const dashboardHrefs = [
  "/dashboard",
  "/opportunities",
  "/matches",
  "/admin"
] as const;

export type DashboardHref = (typeof dashboardHrefs)[number];

export function resolveDashboardHref(pathname: string): DashboardHref {
  return dashboardHrefs.find(
    (href) => pathname === href || pathname.startsWith(`${href}/`)
  ) ?? "/dashboard";
}
