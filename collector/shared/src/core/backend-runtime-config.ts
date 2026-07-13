type BackendCollectorRuntimeConfigResponse = {
  data?: {
    eightxbet_page_url?: string;
    eightxbet_base_url?: string;
    eightxbet_inplay_page_url?: string;
    jun88_base_url?: string;
    jun88_bti_page_url?: string;
    jun88_saba_page_url?: string;
    jun88_cmd_page_url?: string;
    jun88_m9bet_page_url?: string;
    collector_proxy_enabled?: boolean;
    collector_proxy_protocol?: string;
    collector_proxy_server?: string;
    collector_proxy_bypass?: string;
    bti_proxy_enabled?: boolean;
    bti_proxy_protocol?: string;
    bti_proxy_server?: string;
    bti_proxy_bypass?: string;
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
  applySetting("JUN88_BTI_PAGE_URL", payload.data.jun88_bti_page_url);
  applySetting("JUN88_SABA_PAGE_URL", payload.data.jun88_saba_page_url);
  applySetting("JUN88_CMD_PAGE_URL", payload.data.jun88_cmd_page_url);
  applySetting("JUN88_M9BET_PAGE_URL", payload.data.jun88_m9bet_page_url);

  applyProxySettings({
    enabled: payload.data.collector_proxy_enabled,
    protocol: payload.data.collector_proxy_protocol,
    server: payload.data.collector_proxy_server,
    bypass: payload.data.collector_proxy_bypass
  });

  applySetting(
    "BTI_COLLECTOR_PROXY_MODE",
    payload.data.bti_proxy_enabled ? "static" : "off"
  );
  applySetting("BTI_COLLECTOR_PROXY_PROTOCOL", payload.data.bti_proxy_protocol);
  applySetting("BTI_COLLECTOR_PROXY_SERVER", payload.data.bti_proxy_server);
  applySetting("BTI_COLLECTOR_PROXY_BYPASS", payload.data.bti_proxy_bypass);

  return payload.data;
}

function applySetting(key: string, value?: string) {
  process.env[key] = (value ?? "").trim();
}

function applyProxySettings(options: {
  enabled?: boolean;
  protocol?: string;
  server?: string;
  bypass?: string;
}) {
  applySetting("COLLECTOR_PROXY_MODE", options.enabled ? "static" : "off");
  applySetting("COLLECTOR_PROXY_PROTOCOL", options.protocol);
  applySetting("COLLECTOR_PROXY_SERVER", options.server);
  applySetting("COLLECTOR_PROXY_BYPASS", options.bypass);
}

export function applyCollectorProxyProfile(
  config: SyncedCollectorRuntimeConfig,
  profile: "default" | "bti"
) {
  if (profile === "bti" && config.bti_proxy_enabled) {
    applyProxySettings({
      enabled: true,
      protocol: config.bti_proxy_protocol,
      server: config.bti_proxy_server,
      bypass: config.bti_proxy_bypass
    });
    return;
  }

  applyProxySettings({
    enabled: config.collector_proxy_enabled,
    protocol: config.collector_proxy_protocol,
    server: config.collector_proxy_server,
    bypass: config.collector_proxy_bypass
  });
}
