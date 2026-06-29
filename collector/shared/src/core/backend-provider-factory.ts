import { BackendSettingsProvider } from "../backend/backend-settings-provider.js";

export function createBackendSettingsProvider() {
  return new BackendSettingsProvider(
    process.env.BACKEND_API_URL ?? "http://127.0.0.1:8080"
  );
}

