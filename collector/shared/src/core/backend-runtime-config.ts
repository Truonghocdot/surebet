type BackendCollectorRuntimeConfigResponse = {
  data?: {
    eightxbet_base_url?: string;
    eightxbet_inplay_page_url?: string;
    jun88_base_url?: string;
    jun88_cmd_page_url?: string;
  };
};

type SyncCollectorRuntimeConfigOptions = {
  source?: {
    collectorId: string;
    bookmakerId: string;
    lobbyId: string;
  };
  accountId?: string;
  accessToken?: string;
};

export async function syncCollectorRuntimeConfig(
  backendURL: string,
  options: SyncCollectorRuntimeConfigOptions = {}
): Promise<void> {
  const target = `${backendURL.replace(/\/+$/, "")}/v1/collector/runtime-config`;
  const authHeaders = collectorRuntimeAuthHeaders(options);
  const response = await fetch(target, {
    method: "GET",
    headers: {
      Accept: "application/json",
      ...authHeaders
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
}

function collectorRuntimeAuthHeaders(options: SyncCollectorRuntimeConfigOptions): Record<string, string> {
  const source = options.source;
  if (!source) return {};
  const prefix = `${source.bookmakerId}_${source.lobbyId}`
    .replace(/[^a-z0-9]+/gi, "_")
    .toUpperCase();
  const accountId = String(
    options.accountId ?? process.env[`${prefix}_COLLECTOR_ACCOUNT_ID`] ?? process.env.COLLECTOR_ACCOUNT_ID ?? "",
  ).trim();
  const accessToken = String(
    options.accessToken ?? process.env[`${prefix}_COLLECTOR_STREAM_TOKEN`] ?? process.env.COLLECTOR_STREAM_TOKEN ?? "",
  ).trim();
  if (!accountId || !accessToken) return {};
  return {
    "X-Surebet-Collector-ID": source.collectorId,
    "X-Surebet-Bookmaker-ID": source.bookmakerId,
    "X-Surebet-Lobby-ID": source.lobbyId,
    "X-Surebet-Account-ID": accountId,
    "X-Surebet-Collector-Token": accessToken,
  };
}

function applySetting(key: string, value?: string) {
  process.env[key] = (value ?? "").trim();
}
