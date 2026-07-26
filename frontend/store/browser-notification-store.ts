"use client";

import { create } from "zustand";

const browserNotificationPreferenceKey = "surebet:browser-notifications";

type BrowserNotificationPermission = NotificationPermission | "unsupported";

type BrowserNotificationState = {
  enabled: boolean;
  initialized: boolean;
  permission: BrowserNotificationPermission;
  requesting: boolean;
  initialize: () => void;
  requestOnDashboardEntry: () => Promise<void>;
  refreshPermission: () => void;
  toggle: () => Promise<void>;
};

export const useBrowserNotificationStore = create<BrowserNotificationState>(
  (set, get) => ({
    enabled: false,
    initialized: false,
    permission: "unsupported",
    requesting: false,
    initialize: () => {
      if (get().initialized) {
        return;
      }
      if (!supportsBrowserNotifications()) {
        set({ initialized: true, permission: "unsupported" });
        return;
      }

      const permission = window.Notification.permission;
      set({
        enabled: readStoredPreference() === "enabled" && permission === "granted",
        initialized: true,
        permission
      });
    },
    requestOnDashboardEntry: async () => {
      if (!supportsBrowserNotifications() || get().requesting) {
        return;
      }

      const storedPreference = readStoredPreference();
      const permission = window.Notification.permission;
      if (storedPreference === "disabled" || permission === "denied") {
        set({ enabled: false, initialized: true, permission });
        return;
      }
      if (permission === "granted") {
        writeStoredPreference(true);
        set({ enabled: true, initialized: true, permission });
        return;
      }
      if (dashboardPermissionRequestAttempted()) {
        set({ enabled: false, initialized: true, permission });
        return;
      }

      markDashboardPermissionRequestAttempted();
      set({ requesting: true, initialized: true, permission });
      try {
        const nextPermission = await window.Notification.requestPermission();
        const enabled = nextPermission === "granted";
        if (nextPermission !== "default") {
          writeStoredPreference(enabled);
        }
        set({ enabled, initialized: true, permission: nextPermission });
      } finally {
        set({ requesting: false });
      }
    },
    refreshPermission: () => {
      if (!supportsBrowserNotifications()) {
        set({ enabled: false, initialized: true, permission: "unsupported" });
        return;
      }

      const permission = window.Notification.permission;
      set({
        enabled: readStoredPreference() === "enabled" && permission === "granted",
        initialized: true,
        permission
      });
    },
    toggle: async () => {
      if (!supportsBrowserNotifications() || get().requesting) {
        return;
      }
      if (get().enabled) {
        writeStoredPreference(false);
        set({ enabled: false, permission: window.Notification.permission });
        return;
      }

      set({ requesting: true });
      try {
        const permission = window.Notification.permission === "default"
          ? await window.Notification.requestPermission()
          : window.Notification.permission;
        const enabled = permission === "granted";
        writeStoredPreference(enabled);
        set({ enabled, initialized: true, permission });
      } finally {
        set({ requesting: false });
      }
    }
  })
);

function supportsBrowserNotifications() {
  return typeof window !== "undefined" && "Notification" in window;
}

function readStoredPreference() {
  try {
    const value = window.localStorage.getItem(browserNotificationPreferenceKey);
    return value === "enabled" || value === "disabled" ? value : null;
  } catch {
    return null;
  }
}

function dashboardPermissionRequestAttempted() {
  try {
    return window.sessionStorage.getItem("surebet:dashboard-notification-requested") === "yes";
  } catch {
    return false;
  }
}

function markDashboardPermissionRequestAttempted() {
  try {
    window.sessionStorage.setItem("surebet:dashboard-notification-requested", "yes");
  } catch {
    // The browser permission prompt still works without session storage.
  }
}

function writeStoredPreference(enabled: boolean) {
  try {
    window.localStorage.setItem(
      browserNotificationPreferenceKey,
      enabled ? "enabled" : "disabled"
    );
  } catch {
    // Notification permission still works when browser storage is unavailable.
  }
}
