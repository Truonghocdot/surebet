export const dashboardHrefs = [
  "/dashboard",
  "/opportunities",
  "/matches"
] as const;

export type DashboardHref = (typeof dashboardHrefs)[number];

export function resolveDashboardHref(pathname: string): DashboardHref {
  return dashboardHrefs.find(
    (href) => pathname === href || pathname.startsWith(`${href}/`)
  ) ?? "/dashboard";
}
