"use client";

import { startTransition, useCallback, useEffect, useRef } from "react";
import { BadgeCheck, Radar, X } from "lucide-react";
import {
  useRealtimeNotificationStore,
  type OpportunityNotification
} from "@/store/realtime-notification-store";
import { useDashboardSpaStore } from "@/store/dashboard-spa-store";
import { useBrowserNotificationStore } from "@/store/browser-notification-store";

const notificationLifetimeMS = 10_000;

export function RealtimeNotificationCenter() {
  const notifications = useRealtimeNotificationStore((state) => state.notifications);
  const dismissNotification = useRealtimeNotificationStore((state) => state.dismissNotification);
  const setActiveHref = useDashboardSpaStore((state) => state.setActiveHref);
  const browserNotificationsEnabled = useBrowserNotificationStore((state) => state.enabled);
  const browserNotificationsInitialized = useBrowserNotificationStore(
    (state) => state.initialized
  );
  const browserNotificationPermission = useBrowserNotificationStore(
    (state) => state.permission
  );
  const initializeBrowserNotifications = useBrowserNotificationStore(
    (state) => state.initialize
  );
  const dispatchedBrowserNotificationIDs = useRef(new Set<string>());

  const openOpportunities = useCallback((notificationID: string) => {
    window.focus();
    if (window.location.pathname !== "/opportunities") {
      window.history.pushState(null, "", "/opportunities");
    }
    startTransition(() => setActiveHref("/opportunities"));
    dismissNotification(notificationID);
  }, [dismissNotification, setActiveHref]);

  useEffect(() => {
    initializeBrowserNotifications();
  }, [initializeBrowserNotifications]);

  useEffect(() => {
    if (!browserNotificationsInitialized) {
      return;
    }

    const freshNotifications = notifications.filter(
      (notification) => !dispatchedBrowserNotificationIDs.current.has(notification.id)
    );
    for (const notification of freshNotifications) {
      dispatchedBrowserNotificationIDs.current.add(notification.id);
    }

    if (
      !browserNotificationsEnabled ||
      browserNotificationPermission !== "granted"
    ) {
      return;
    }

    for (const notification of freshNotifications) {
      showBrowserNotification(notification, () => openOpportunities(notification.id));
    }
  }, [
    browserNotificationPermission,
    browserNotificationsEnabled,
    browserNotificationsInitialized,
    notifications,
    openOpportunities
  ]);

  useEffect(() => {
    const timers = notifications.map((notification) => window.setTimeout(
      () => dismissNotification(notification.id),
      notificationLifetimeMS
    ));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [dismissNotification, notifications]);

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

function showBrowserNotification(
  notification: OpportunityNotification,
  onOpen: () => void
) {
  try {
    const confirmed = notification.kind === "confirmed";
    const browserNotification = new Notification(
      confirmed ? "Kèo đã xác nhận" : "Phát hiện kèo mới",
      {
        body: `${notification.fixtureID} - ${notification.marketName} - +${notification.profitPercentage.toFixed(2)}%`,
        tag: notification.id
      }
    );
    browserNotification.onclick = () => {
      onOpen();
      browserNotification.close();
    };
  } catch {
    // The in-app notification remains available when native delivery fails.
  }
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
