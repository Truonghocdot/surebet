"use client";

import { startTransition, useEffect } from "react";
import { BadgeCheck, Radar, X } from "lucide-react";
import {
  useRealtimeNotificationStore,
  type OpportunityNotification
} from "@/store/realtime-notification-store";
import { useDashboardSpaStore } from "@/store/dashboard-spa-store";

const notificationLifetimeMS = 10_000;

export function RealtimeNotificationCenter() {
  const notifications = useRealtimeNotificationStore((state) => state.notifications);
  const dismissNotification = useRealtimeNotificationStore((state) => state.dismissNotification);
  const setActiveHref = useDashboardSpaStore((state) => state.setActiveHref);

  useEffect(() => {
    const timers = notifications.map((notification) => window.setTimeout(
      () => dismissNotification(notification.id),
      notificationLifetimeMS
    ));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [dismissNotification, notifications]);

  function openOpportunities(notificationID: string) {
    if (window.location.pathname !== "/opportunities") {
      window.history.pushState(null, "", "/opportunities");
    }
    startTransition(() => setActiveHref("/opportunities"));
    dismissNotification(notificationID);
  }

  return (
    <div
      aria-atomic="false"
      aria-live="polite"
      className="pointer-events-none fixed right-3 top-20 z-50 grid w-[min(calc(100vw-1.5rem),380px)] gap-2 sm:right-5 sm:top-24"
    >
      {notifications.map((notification) => (
        <OpportunityNotificationToast
          key={notification.id}
          notification={notification}
          onDismiss={() => dismissNotification(notification.id)}
          onOpen={() => openOpportunities(notification.id)}
        />
      ))}
    </div>
  );
}

function OpportunityNotificationToast({
  notification,
  onDismiss,
  onOpen
}: {
  notification: OpportunityNotification;
  onDismiss: () => void;
  onOpen: () => void;
}) {
  const confirmed = notification.kind === "confirmed";
  const Icon = confirmed ? BadgeCheck : Radar;

  return (
    <div
      className="pointer-events-auto grid grid-cols-[40px_minmax(0,1fr)_32px] items-start gap-3 border border-[color:var(--line)] bg-white p-3 shadow-[var(--shadow)]"
      role="status"
    >
      <div
        className={`flex size-10 items-center justify-center rounded-lg ${
          confirmed
            ? "bg-emerald-500/15 text-emerald-700"
            : "bg-amber-500/15 text-amber-800"
        }`}
      >
        <Icon aria-hidden="true" className="size-5" />
      </div>
      <button
        className="min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]/35"
        onClick={onOpen}
        type="button"
      >
        <p className="text-sm font-semibold text-[var(--ink)]">
          {confirmed ? "Kèo đã xác nhận" : "Phát hiện kèo mới"}
        </p>
        <p className="mt-0.5 truncate text-xs text-[var(--muted)]">
          {notification.fixtureID} · {notification.marketName}
        </p>
        <p className={`mt-1 text-sm font-semibold ${
          confirmed ? "text-emerald-700" : "text-amber-800"
        }`}>
          +{notification.profitPercentage.toFixed(2)}%
        </p>
      </button>
      <button
        aria-label="Đóng thông báo"
        className="inline-flex size-8 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-black/5 hover:text-[var(--ink)]"
        onClick={onDismiss}
        title="Đóng thông báo"
        type="button"
      >
        <X aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}
