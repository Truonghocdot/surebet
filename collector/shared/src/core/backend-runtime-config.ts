type BackendCollectorRuntimeConfigResponse = {
  data?: {
    eightxbet_page_url?: string;
    eightxbet_base_url?: string;
    eightxbet_inplay_page_url?: string;
    jun88_base_url?: string;
    jun88_cmd_page_url?: string;
    collector_proxyxoay_token?: string;
  };
};

export type SyncedCollectorRuntimeConfig =
  NonNullable<BackendCollectorRuntimeConfigResponse["data"]>;

export async function syncCollectorRuntimeConfig(
  backendURL: string
): Promise<SyncedCollectorRuntimeConfig> {
  const target = `${backendURL.replace(/\/+$/, "")}/v1/collector/runtime-config`;
  const response = await fetch(target, {
    method: "GET",
    headers: {
      Accept: "application/json"
    }
  });

  const payload = (await response.json().catch(() => null)) as BackendCollectorRuntimeConfigResponse | null;
  if (!response.ok || !payload?.data) {
    throw new Error(
      `collector runtime config request failed: ${response.status} ${target}`
    );
  }

  applySetting("EIGHTXBET_PAGE_URL", payload.data.eightxbet_page_url);
  applySetting("EIGHTXBET_BASE_URL", payload.data.eightxbet_base_url);
  applySetting("EIGHTXBET_INPLAY_PAGE_URL", payload.data.eightxbet_inplay_page_url);
  applySetting("JUN88_BASE_URL", payload.data.jun88_base_url);
  applySetting("JUN88_CMD_PAGE_URL", payload.data.jun88_cmd_page_url);

  applyProxySettings({
    token: payload.data.collector_proxyxoay_token
  });

  return payload.data;
}

function applySetting(key: string, value?: string) {
  process.env[key] = (value ?? "").trim();
}

function applyProxySettings(options: {
  token?: string;
}) {
  const token = (options.token ?? "").trim();
  applySetting("COLLECTOR_PROXY_MODE", token ? "proxyxoay" : "off");
  applySetting("COLLECTOR_PROXY_PROTOCOL", token ? "http" : "");
  applySetting("COLLECTOR_PROXYXOAY_KEY", token);
  applySetting("COLLECTOR_PROXYXOAY_NHAMANG", token ? "random" : "");
  applySetting("COLLECTOR_PROXYXOAY_TINHTHANH", token ? "0" : "");
  applySetting("COLLECTOR_PROXYXOAY_WHITELIST", "");
  applySetting("COLLECTOR_PROXY_SERVER", "");
  applySetting("COLLECTOR_PROXY_BYPASS", "");
  applySetting("COLLECTOR_PROXY_CACHE_ENABLED", token ? "true" : "");
  applySetting("COLLECTOR_PROXY_CACHE_FILE", token ? "tmp/collector/proxyxoay-cache.json" : "");
}

export function applyCollectorProxyProfile(config: SyncedCollectorRuntimeConfig) {
  applyProxySettings({
    token: config.collector_proxyxoay_token
  });
}
