"use client";

import { useEffect } from "react";
import { Bell, BellOff } from "lucide-react";
import { useBrowserNotificationStore } from "@/store/browser-notification-store";
import { cn } from "@/lib/utils";

export function BrowserNotificationButton() {
  const enabled = useBrowserNotificationStore((state) => state.enabled);
  const initialized = useBrowserNotificationStore((state) => state.initialized);
  const permission = useBrowserNotificationStore((state) => state.permission);
  const requesting = useBrowserNotificationStore((state) => state.requesting);
  const initialize = useBrowserNotificationStore((state) => state.initialize);
  const refreshPermission = useBrowserNotificationStore((state) => state.refreshPermission);
  const toggle = useBrowserNotificationStore((state) => state.toggle);

  useEffect(() => {
    initialize();
    window.addEventListener("focus", refreshPermission);
    return () => window.removeEventListener("focus", refreshPermission);
  }, [initialize, refreshPermission]);

  const label = notificationButtonLabel(enabled, permission);
  const Icon = enabled ? Bell : BellOff;

  return (
    <button
      aria-label={label}
      aria-pressed={enabled}
      className={cn(
        "inline-flex size-10 shrink-0 items-center justify-center rounded-lg border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]/35",
        enabled
          ? "border-emerald-600/30 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/15"
          : "border-[color:var(--line)] bg-white/80 text-[var(--muted)] hover:bg-white hover:text-[var(--ink)]"
      )}
      disabled={!initialized || requesting || permission === "unsupported"}
      onClick={() => void toggle()}
      title={label}
      type="button"
    >
      <Icon aria-hidden="true" className="size-5" />
    </button>
  );
}

function notificationButtonLabel(
  enabled: boolean,
  permission: NotificationPermission | "unsupported"
) {
  if (permission === "unsupported") {
    return "Trình duyệt không hỗ trợ thông báo";
  }
  if (permission === "denied") {
    return "Thông báo đang bị Chrome chặn";
  }
  return enabled ? "Tắt thông báo Chrome" : "Bật thông báo Chrome";
}
