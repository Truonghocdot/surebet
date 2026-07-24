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
        enabled: readStoredPreference() && permission === "granted",
        initialized: true,
        permission
      });
    },
    refreshPermission: () => {
      if (!supportsBrowserNotifications()) {
        set({ enabled: false, initialized: true, permission: "unsupported" });
        return;
      }

      const permission = window.Notification.permission;
      set({
        enabled: readStoredPreference() && permission === "granted",
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
    return window.localStorage.getItem(browserNotificationPreferenceKey) === "enabled";
  } catch {
    return false;
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
