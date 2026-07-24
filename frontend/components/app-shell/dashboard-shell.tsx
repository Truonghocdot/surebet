"use client";

import {
  startTransition,
  useEffect,
  type MouseEvent
} from "react";
import { usePathname } from "next/navigation";
import { Bolt, LogOut, Menu, X } from "lucide-react";
import { DashboardSpaRouter } from "@/features/dashboard/components/dashboard-spa-router";
import { RealtimeNotificationCenter } from "@/features/dashboard/components/realtime-notification-center";
import { useRealtimeWebSocket } from "@/features/dashboard/queries/use-crm-queries";
import { SessionHydrator } from "@/features/auth/components/session-hydrator";
import { useSessionStore } from "@/features/auth/store/session-store";
import {
  resolveDashboardHref,
  type DashboardHref
} from "@/lib/dashboard-spa";
import { navigationItems } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { useAppShellStore } from "@/store/app-shell-store";
import { useDashboardSpaStore } from "@/store/dashboard-spa-store";
import { Button } from "@/components/ui/button";

type DashboardShellProps = {
  children: React.ReactNode;
  user: {
    id?: string;
    email: string;
    fullName: string;
    role: string;
  };
  logout: () => Promise<void>;
};

export function DashboardShell({ user, logout }: DashboardShellProps) {
  useRealtimeWebSocket();
  const pathname = usePathname();
  const sessionUser = useSessionStore((state) => state.user);
  const mobileOpened = useAppShellStore((state) => state.mobileOpened);
  const toggleMobileNav = useAppShellStore((state) => state.toggleMobileNav);
  const closeMobileNav = useAppShellStore((state) => state.closeMobileNav);
  const activeHref = useDashboardSpaStore((state) => state.activeHref);
  const setActiveHref = useDashboardSpaStore((state) => state.setActiveHref);
  const displayUser = sessionUser ?? user;
  const currentHref = activeHref ?? resolveDashboardHref(pathname);
  const navItems = navigationItems(displayUser);

  useEffect(() => {
    const syncFromLocation = () => {
      setActiveHref(resolveDashboardHref(window.location.pathname));
    };

    syncFromLocation();
    window.addEventListener("popstate", syncFromLocation);
    return () => {
      window.removeEventListener("popstate", syncFromLocation);
    };
  }, [setActiveHref]);

  useEffect(() => {
    closeMobileNav();
  }, [pathname, closeMobileNav]);

  useEffect(() => {
    if (!mobileOpened) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileOpened]);

  function handleDashboardNavigation(
    event: MouseEvent<HTMLAnchorElement>,
    href: DashboardHref
  ) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.altKey ||
      event.ctrlKey ||
      event.shiftKey
    ) {
      return;
    }

    event.preventDefault();
    if (window.location.pathname !== href) {
      window.history.pushState(null, "", href);
    }

    startTransition(() => {
      setActiveHref(href);
      closeMobileNav();
    });
  }

  return (
    <div className="min-h-screen bg-[var(--app-bg)] text-[var(--ink)]">
      <SessionHydrator user={user} />
      <RealtimeNotificationCenter />

      <header className="sticky top-0 z-40 border-b border-[color:var(--line)] bg-white/80 backdrop-blur-xl">
        <div className="mx-auto flex min-h-16 w-full items-center justify-between gap-3 px-3 py-2 sm:px-4 md:h-20 md:px-6 md:py-0">
          <div className="flex min-w-0 items-center gap-3">
            <button
              aria-label="Mở hoặc đóng thanh điều hướng"
              className="inline-flex size-10 items-center justify-center rounded-[20px] border border-[color:var(--line)] bg-white text-[var(--ink)] shadow-sm md:hidden"
              onClick={toggleMobileNav}
              type="button"
            >
              {mobileOpened ? <X className="size-5" /> : <Menu className="size-5" />}
            </button>

            <div className="flex min-w-0 items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[var(--accent)]/10 text-[var(--accent)] md:size-11">
                <Bolt className="size-5" />
              </div>
              <div className="min-w-0">
                <p className="truncate font-display text-sm font-semibold sm:text-base md:text-lg">
                  Bảng theo dõi tỷ lệ
                </p>
                <p className="hidden text-sm text-[var(--muted)] md:block">
                  Theo dõi dữ liệu quét, so sánh tỷ lệ và hiển thị cơ hội
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 md:gap-3">
            <div className="rounded-full border border-[color:var(--line)] bg-[var(--surface-soft)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)] md:hidden">
              {displayUser.role === "super_admin" ? "Super admin" : "Vận hành"}
            </div>
            <div className="hidden text-right lg:block">
              <p className="font-semibold">{displayUser.fullName}</p>
              <p className="text-sm text-[var(--muted)]">{displayUser.email}</p>
            </div>
            <form action={logout} className="hidden md:block">
              <Button className="gap-2" type="submit" variant="secondary">
                <LogOut className="size-4" />
                Đăng xuất
              </Button>
            </form>
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full items-start gap-0">
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
            "fixed inset-y-0 left-0 z-40 flex w-[min(86vw,304px)] flex-col border-r border-white/10 bg-[var(--bg-deep)] px-3 py-3 text-white shadow-[0_28px_70px_rgba(0,0,0,0.35)] transition-transform duration-200 sm:px-4 sm:py-4 md:sticky md:top-20 md:h-[calc(100vh-5rem)] md:w-[304px] md:shadow-none",
            mobileOpened ? "translate-x-0" : "-translate-x-full",
            "md:translate-x-0"
          )}
        >
          <div className="flex h-full flex-col gap-4">
            <div className="flex items-center justify-between gap-3 rounded-[22px] border border-white/10 bg-white/6 p-4 md:hidden">
              <div>
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-white/55">
                  Điều hướng
                </p>
                <p className="mt-1 font-display text-base font-semibold text-white">
                  Surebet dashboard
                </p>
              </div>
              <button
                aria-label="Đóng thanh điều hướng"
                className="inline-flex size-10 items-center justify-center rounded-[18px] border border-white/10 bg-white/8 text-white"
                onClick={closeMobileNav}
                type="button"
              >
                <X className="size-5" />
              </button>
            </div>

            <div className="rounded-[24px] border border-white/10 bg-white/5 p-4 md:p-5">
              <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-white/60">
                Phiên hiện tại
              </p>
              <p className="mt-3 font-semibold text-white">{displayUser.fullName}</p>
              <p className="mt-1 break-all text-sm text-white/68">{displayUser.email}</p>
              <p className="mt-3 text-xs uppercase tracking-[0.16em] text-white/45">
                {displayUser.role === "super_admin" ? "Super admin" : "Operator"}
              </p>
            </div>

            <nav className="flex-1 space-y-2 overflow-y-auto pr-1">
              {navItems.map((item) => {
                const href = resolveDashboardHref(item.href);
                const active = currentHref === href;
                const Icon = item.icon;

                return (
                  <a
                    className={cn(
                      "grid grid-cols-[40px_1fr] items-start gap-3 rounded-[18px] border border-transparent px-3 py-3 transition hover:translate-x-1 hover:bg-white/5 md:grid-cols-[42px_1fr] md:rounded-[20px]",
                      active &&
                        "border-white/10 bg-[linear-gradient(135deg,rgba(11,138,119,0.78),rgba(7,56,50,0.9))] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
                    )}
                    href={href}
                    key={item.href}
                    onClick={(event) => handleDashboardNavigation(event, href)}
                  >
                    <span className="flex size-10 items-center justify-center rounded-2xl bg-white/8 md:size-[42px]">
                      <Icon className="size-[18px]" strokeWidth={1.7} />
                    </span>
                    <span>
                      <span className="block font-semibold">{item.label}</span>
                      {item.description ? (
                        <span
                          className={cn(
                            "mt-1 block text-sm",
                            active ? "text-teal-50" : "text-white/62"
                          )}
                        >
                          {item.description}
                        </span>
                      ) : null}
                    </span>
                  </a>
                );
              })}
            </nav>

            <div className="grid gap-3 rounded-[24px] border border-white/10 bg-[linear-gradient(145deg,rgba(255,155,84,0.18),rgba(255,255,255,0.06))] p-4 md:p-5">
              <div>
                <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-white/60">
                  So sánh và hiển thị
                </p>
                <p className="mt-2 text-sm leading-6 text-white/68">
                  Theo dõi dữ liệu quét theo thời gian thực và thao tác nhanh ngay trên
                  điện thoại.
                </p>
              </div>
              <form action={logout} className="md:hidden">
                <Button className="w-full gap-2" type="submit" variant="secondary">
                  <LogOut className="size-4" />
                  Đăng xuất
                </Button>
              </form>
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1 px-3 py-4 sm:px-4 sm:py-6 md:px-6 md:py-8">
          <DashboardSpaRouter activeHref={currentHref} />
        </main>
      </div>
    </div>
  );
}
