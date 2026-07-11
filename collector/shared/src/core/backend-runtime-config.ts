type BackendCollectorRuntimeConfigResponse = {
  data?: {
    eightxbet_page_url?: string;
    eightxbet_base_url?: string;
    jun88_base_url?: string;
    jun88_bti_page_url?: string;
    jun88_saba_page_url?: string;
    jun88_cmd_page_url?: string;
    jun88_m9bet_page_url?: string;
  };
};

export async function syncCollectorRuntimeConfig(
  backendURL: string
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

  applySetting("EIGHTXBET_PAGE_URL", payload.data.eightxbet_page_url);
  applySetting("EIGHTXBET_BASE_URL", payload.data.eightxbet_base_url);
  applySetting("JUN88_BASE_URL", payload.data.jun88_base_url);
  applySetting("JUN88_BTI_PAGE_URL", payload.data.jun88_bti_page_url);
  applySetting("JUN88_SABA_PAGE_URL", payload.data.jun88_saba_page_url);
  applySetting("JUN88_CMD_PAGE_URL", payload.data.jun88_cmd_page_url);
  applySetting("JUN88_M9BET_PAGE_URL", payload.data.jun88_m9bet_page_url);
}

function applySetting(key: string, value?: string) {
  process.env[key] = (value ?? "").trim();
}
