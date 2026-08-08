type BackendCollectorRuntimeConfigResponse = {
  data?: {
    eightxbet_base_url?: string;
    eightxbet_inplay_page_url?: string;
    jun88_base_url?: string;
    jun88_cmd_page_url?: string;
    collector_proxyxoay_token?: string;
  };
};

type SyncCollectorRuntimeConfigOptions = {
  applyProxy?: boolean;
};

export async function syncCollectorRuntimeConfig(
  backendURL: string,
  options: SyncCollectorRuntimeConfigOptions = {}
): Promise<void> {
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

  applySetting("EIGHTXBET_BASE_URL", payload.data.eightxbet_base_url);
  applySetting("EIGHTXBET_INPLAY_PAGE_URL", payload.data.eightxbet_inplay_page_url);
  applySetting("JUN88_BASE_URL", payload.data.jun88_base_url);
  applySetting("JUN88_CMD_PAGE_URL", payload.data.jun88_cmd_page_url);

  if (options.applyProxy !== false) {
    applyProxySettings({
      token: payload.data.collector_proxyxoay_token
    });
  }
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
