import { DashboardShell } from "@/components/app-shell/dashboard-shell";
import {
  getSessionUser,
  logoutAction
} from "@/features/auth/server/session";

export default async function DashboardLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();

  if (!user) {
    return children;
  }

  return (
    <DashboardShell logout={logoutAction} user={user}>
      {children}
    </DashboardShell>
  );
}
