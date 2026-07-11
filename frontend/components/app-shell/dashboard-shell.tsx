"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bolt, LogOut, Menu, X } from "lucide-react";
import { SessionHydrator } from "@/features/auth/components/session-hydrator";
import { useSessionStore } from "@/features/auth/store/session-store";
import { navigationItems } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { useAppShellStore } from "@/store/app-shell-store";
import { Button } from "@/components/ui/button";

type DashboardShellProps = {
  children: React.ReactNode;
  user: {
    email: string;
    fullName: string;
  };
  logout: () => Promise<void>;
};

export function DashboardShell({ children, user, logout }: DashboardShellProps) {
  const pathname = usePathname();
  const sessionUser = useSessionStore((state) => state.user);
  const mobileOpened = useAppShellStore((state) => state.mobileOpened);
  const toggleMobileNav = useAppShellStore((state) => state.toggleMobileNav);
  const closeMobileNav = useAppShellStore((state) => state.closeMobileNav);
  const displayUser = sessionUser ?? user;

  return (
    <div className="min-h-screen bg-[var(--app-bg)] text-[var(--ink)]">
      <SessionHydrator user={user} />

      <header className="sticky top-0 z-40 border-b border-[color:var(--line)] bg-white/80 backdrop-blur-xl">
        <div className="mx-auto flex h-20 w-full items-center justify-between gap-4 px-4 md:px-6">
          <div className="flex items-center gap-3">
            <button
              aria-label="Mở hoặc đóng thanh điều hướng"
              className="inline-flex size-11 items-center justify-center rounded-2xl border border-[color:var(--line)] bg-white text-[var(--ink)] shadow-sm md:hidden"
              onClick={toggleMobileNav}
              type="button"
            >
              {mobileOpened ? <X className="size-5" /> : <Menu className="size-5" />}
            </button>

            <div className="flex items-center gap-3">
              <div className="flex size-11 items-center justify-center rounded-2xl bg-[var(--accent)]/10 text-[var(--accent)]">
                <Bolt className="size-5" />
              </div>
              <div>
                <p className="font-display text-lg font-semibold">Bảng theo dõi tỷ lệ</p>
                <p className="text-sm text-[var(--muted)]">
                  Theo dõi dữ liệu quét, so sánh tỷ lệ và hiển thị cơ hội
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden text-right md:block">
              <p className="font-semibold">{displayUser.fullName}</p>
              <p className="text-sm text-[var(--muted)]">{displayUser.email}</p>
            </div>
            <form action={logout}>
              <Button className="gap-2" type="submit" variant="secondary">
                <LogOut className="size-4" />
                Đăng xuất
              </Button>
            </form>
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full gap-0">
        {mobileOpened ? (
          <button
            aria-label="Đóng lớp điều hướng"
            className="fixed inset-0 z-30 bg-slate-950/45 md:hidden"
            onClick={closeMobileNav}
            type="button"
          />
        ) : null}

        <aside
          className={cn(
            "fixed inset-y-0 left-0 z-40 w-[304px] border-r border-white/10 bg-[var(--bg-deep)] px-4 py-4 text-white transition-transform duration-200 md:sticky md:top-20 md:block md:h-[calc(100vh-5rem)]",
            mobileOpened ? "translate-x-0" : "-translate-x-full",
            "md:translate-x-0"
          )}
        >
          <div className="flex h-full flex-col gap-4">
            <div className="rounded-[24px] border border-white/10 bg-white/5 p-5">
              <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-white/60">
                Theo dõi dữ liệu
              </p>
            </div>

            <nav className="flex-1 space-y-2 overflow-y-auto pr-1">
              {navigationItems.map((item) => {
                const active =
                  pathname === item.href || pathname.startsWith(`${item.href}/`);
                const Icon = item.icon;

                return (
                  <Link
                    className={cn(
                      "grid grid-cols-[42px_1fr] gap-3 rounded-[20px] border border-transparent px-3 py-3 transition hover:translate-x-1 hover:bg-white/5",
                      active &&
                        "border-white/10 bg-[linear-gradient(135deg,rgba(11,138,119,0.78),rgba(7,56,50,0.9))] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
                    )}
                    href={item.href}
                    key={item.href}
                    onClick={closeMobileNav}
                  >
                    <span className="flex size-[42px] items-center justify-center rounded-2xl bg-white/8">
                      <Icon className="size-[18px]" strokeWidth={1.7} />
                    </span>
                    <span>
                      <span className="block font-semibold">{item.label}</span>
                      <span
                        className={cn(
                          "mt-1 block text-sm",
                          active ? "text-teal-50" : "text-white/62"
                        )}
                      >
                        {item.description}
                      </span>
                    </span>
                  </Link>
                );
              })}
            </nav>

            <div className="rounded-[24px] border border-white/10 bg-[linear-gradient(145deg,rgba(255,155,84,0.18),rgba(255,255,255,0.06))] p-5">
              <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-white/60">
                So sánh và hiển thị
              </p>
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1 px-4 py-6 md:px-6 md:py-8">{children}</main>
      </div>
    </div>
  );
}
