import assert from "node:assert/strict";
import test from "node:test";
import { useBrowserNotificationStore } from "@/store/browser-notification-store";

test("requests notification permission once on the first dashboard entry", async () => {
  const originalWindow = globalThis.window;
  const localValues = new Map<string, string>();
  const sessionValues = new Map<string, string>();
  let permission: NotificationPermission = "default";
  let requestCount = 0;
  const notificationAPI = {
    get permission() {
      return permission;
    },
    requestPermission: async () => {
      requestCount += 1;
      permission = "granted";
      return permission;
    }
  };

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      Notification: notificationAPI,
      localStorage: storage(localValues),
      sessionStorage: storage(sessionValues)
    }
  });

  try {
    useBrowserNotificationStore.setState({
      enabled: false,
      initialized: false,
      permission: "unsupported",
      requesting: false
    });
    await useBrowserNotificationStore.getState().requestOnDashboardEntry();
    await useBrowserNotificationStore.getState().requestOnDashboardEntry();

    assert.equal(requestCount, 1);
    assert.equal(useBrowserNotificationStore.getState().enabled, true);
    assert.equal(useBrowserNotificationStore.getState().permission, "granted");
    assert.equal(localValues.get("surebet:browser-notifications"), "enabled");
    assert.equal(sessionValues.get("surebet:dashboard-notification-requested"), "yes");
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow
    });
  }
});

function storage(values: Map<string, string>) {
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value)
  };
}
