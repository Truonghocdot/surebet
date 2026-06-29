import { BackendSettingsProvider } from "../backend/backend-settings-provider.js";
import { envString } from "./env.js";

export function createBackendSettingsProvider() {
  return new BackendSettingsProvider(
    envString("BACKEND_API_URL", "http://127.0.0.1:8080")
  );
}
