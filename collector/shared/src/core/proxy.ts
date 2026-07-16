import crypto from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { envBool, envInt, envString } from "./env.js";

const proxyXoayEndpoint = "https://proxyxoay.shop/api/get.php";
const defaultProxyCachePath = path.resolve("tmp/collector/proxyxoay-cache.json");
const proxyXoayRefreshIntervalMs = 60_000;
const proxyCacheExpirySkewMs = 15_000;
const proxyCacheFallbackGraceMs = 3 * 60_000;

type CollectorProxySettings = {
  server: string;
  bypass?: string;
  username?: string;
  password?: string;
};

type ProxyXoayResponse = {
  status?: number | string;
  message?: string;
  proxyhttp?: string;
  proxysocks5?: string;
  "Nha Mang"?: string;
  "Vi Tri"?: string;
  "Token expiration date"?: string;
};

type ProxyXoayCache = {
  version: 1;
  cacheKey: string;
  protocol: "http" | "socks5";
  settings: CollectorProxySettings;
  acquiredAt: string;
  expiresAt?: string;
  providerMessage?: string;
  providerNetwork?: string;
  providerRegion?: string;
  providerTokenExpirationDate?: string;
};

export type CollectorProxyDebugInfo = {
  mode: "off" | "static" | "proxyxoay" | string;
  protocol?: "http" | "socks5";
  server?: string;
  hasCredentials?: boolean;
  bypass?: string;
  proxyXoayKeyConfigured?: boolean;
};

export async function resolveCollectorProxy(): Promise<CollectorProxySettings | undefined> {
  const mode = resolveProxyMode();
  if (mode === "off") {
    return undefined;
  }

  if (mode === "static") {
    return resolveStaticProxy(true);
  }

  if (mode === "proxyxoay") {
    return resolveProxyXoayProxy();
  }

  throw new Error(`Unsupported collector proxy mode: ${mode}`);
}

export function startCollectorProxyCacheRefresh(collectorId: string) {
  if (resolveProxyMode() !== "proxyxoay") {
    return () => undefined;
  }

  const intervalMs = Math.max(
    envInt("COLLECTOR_PROXY_REFRESH_MS", proxyXoayRefreshIntervalMs),
    proxyXoayRefreshIntervalMs
  );
  const timer = setInterval(() => {
    void resolveProxyXoayProxy().catch((error) => {
      console.warn(`[${collectorId}-worker] proxy cache refresh failed:`, error);
    });
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

export function collectorProxyDebugInfo(): CollectorProxyDebugInfo {
  const mode = resolveProxyMode();
  if (mode === "off") {
    return { mode };
  }

  if (mode === "static") {
    const rawServer = envString("COLLECTOR_PROXY_SERVER", "").trim();
    if (!rawServer) {
      return { mode, server: "" };
    }

    const protocol = normalizeProxyProtocol(
      envString("COLLECTOR_PROXY_PROTOCOL", inferProtocolFromServer(rawServer)).trim()
    );
    const parsed = parseProxyValue(rawServer, protocol);

    return {
      mode,
      protocol,
      server: parsed.server,
      hasCredentials: Boolean(parsed.username || parsed.password),
      bypass: normalizeBypass(envString("COLLECTOR_PROXY_BYPASS", "").trim())
    };
  }

  if (mode === "proxyxoay") {
    const protocol = normalizeProxyProtocol(
      envString("COLLECTOR_PROXY_PROTOCOL", "http").trim()
    );

    return {
      mode,
      protocol,
      proxyXoayKeyConfigured: envString("COLLECTOR_PROXYXOAY_KEY", "").trim() !== "",
      bypass: normalizeBypass(envString("COLLECTOR_PROXY_BYPASS", "").trim())
    };
  }

  return { mode };
}

export function logCollectorProxyDebug(collectorId: string) {
  const proxy = collectorProxyDebugInfo();
  console.log(
    `[${collectorId}-worker] proxy debug: mode=${proxy.mode}` +
      `${proxy.protocol ? ` protocol=${proxy.protocol}` : ""}` +
      `${proxy.server ? ` server=${proxy.server}` : ""}` +
      `${proxy.hasCredentials !== undefined ? ` has_credentials=${proxy.hasCredentials}` : ""}` +
      `${proxy.proxyXoayKeyConfigured !== undefined ? ` proxyxoay_key_configured=${proxy.proxyXoayKeyConfigured}` : ""}` +
      `${proxy.bypass ? ` bypass=${proxy.bypass}` : ""}`
  );
}

function resolveProxyMode() {
  const explicit = envString("COLLECTOR_PROXY_MODE", "").trim().toLowerCase();
  if (explicit) {
    return explicit;
  }

  if (envString("COLLECTOR_PROXYXOAY_KEY", "").trim()) {
    return "proxyxoay";
  }

  if (envString("COLLECTOR_PROXY_SERVER", "").trim()) {
    return "static";
  }

  return "off";
}

function resolveStaticProxy(required: boolean) {
  const rawServer = envString("COLLECTOR_PROXY_SERVER", "").trim();
  if (!rawServer) {
    if (required) {
      throw new Error("COLLECTOR_PROXY_SERVER is required when proxy mode is static.");
    }
    return undefined;
  }

  const protocol = normalizeProxyProtocol(
    envString("COLLECTOR_PROXY_PROTOCOL", inferProtocolFromServer(rawServer)).trim()
  );
  const credentials = parseProxyValue(rawServer, protocol);

  return {
    server: credentials.server,
    username: credentials.username,
    password: credentials.password,
    bypass: normalizeBypass(envString("COLLECTOR_PROXY_BYPASS", "").trim())
  } satisfies CollectorProxySettings;
}

async function resolveProxyXoayProxy(): Promise<CollectorProxySettings> {
  const key = envString("COLLECTOR_PROXYXOAY_KEY", "").trim();
  if (!key) {
    throw new Error("COLLECTOR_PROXYXOAY_KEY is required when proxy mode is proxyxoay.");
  }

  const protocol = normalizeProxyProtocol(
    envString("COLLECTOR_PROXY_PROTOCOL", "http").trim()
  );
  const cacheKey = buildProxyXoayCacheKey({
    key,
    protocol,
    nhamang: envString("COLLECTOR_PROXYXOAY_NHAMANG", "random").trim() || "random",
    tinhthanh: envString("COLLECTOR_PROXYXOAY_TINHTHANH", "0").trim() || "0",
    whitelist: envString("COLLECTOR_PROXYXOAY_WHITELIST", "").trim(),
    bypass: envString("COLLECTOR_PROXY_BYPASS", "").trim()
  });
  const timeoutMs = envInt("COLLECTOR_PROXY_TIMEOUT_MS", 10_000);
  const query = new URLSearchParams({
    key,
    nhamang: envString("COLLECTOR_PROXYXOAY_NHAMANG", "random").trim() || "random",
    tinhthanh: envString("COLLECTOR_PROXYXOAY_TINHTHANH", "0").trim() || "0",
    whitelist: envString("COLLECTOR_PROXYXOAY_WHITELIST", "").trim()
  });
  const cachedProxy = await readProxyXoayCache(cacheKey);
  if (cachedProxy && isProxyCacheFresh(cachedProxy) && isProxyCacheUsable(cachedProxy)) {
    console.log(
      `[collector-proxy] reusing cached ${protocol.toUpperCase()} proxy ${cachedProxy.settings.server} ` +
        `(network=${cachedProxy.providerNetwork || "unknown"} region=${cachedProxy.providerRegion || "unknown"})`
    );
    return cachedProxy.settings;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${proxyXoayEndpoint}?${query.toString()}`, {
      method: "GET",
      signal: controller.signal,
      headers: {
        Accept: "application/json"
      }
    });

    const payload = (await response.json().catch(() => null)) as ProxyXoayResponse | null;
    if (!response.ok || !payload) {
      throw new Error(
        `ProxyXoay request failed with status ${response.status}${payload?.message ? `: ${payload.message}` : ""}`
      );
    }

    const status = Number(payload.status ?? 0);
    if (status !== 100) {
      throw new Error(payload.message || `ProxyXoay returned status ${String(payload.status)}`);
    }

    const rawProxy =
      protocol === "socks5"
        ? payload.proxysocks5?.trim()
        : payload.proxyhttp?.trim();
    if (!rawProxy) {
      throw new Error(
        `ProxyXoay did not return a ${protocol.toUpperCase()} proxy in the response payload.`
      );
    }

    const settings = {
      ...parseProxyValue(rawProxy, protocol),
      bypass: normalizeBypass(envString("COLLECTOR_PROXY_BYPASS", "").trim())
    } satisfies CollectorProxySettings;
    const cacheEntry = buildProxyXoayCache(cacheKey, protocol, settings, payload);
    await writeProxyXoayCache(cacheEntry);

    console.log(
      `[collector-proxy] using ${protocol.toUpperCase()} proxy ${settings.server} ` +
        `(network=${payload["Nha Mang"] || "unknown"} region=${payload["Vi Tri"] || "unknown"})`
    );

    return settings;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (cachedProxy && canReuseCachedProxyAfterFailure(cachedProxy, message)) {
      console.warn(
        `[collector-proxy] ProxyXoay unavailable (${message}); continuing with cached proxy ${cachedProxy.settings.server}`
      );
      return cachedProxy.settings;
    }
    throw new Error(`ProxyXoay acquisition failed: ${message}`);
  } finally {
    clearTimeout(timeout);
  }
}

function parseProxyValue(rawValue: string, protocol: string) {
  const sanitized = rawValue
    .trim()
    .replace(/^(https?|socks5):\/\//i, "");
  const parts = sanitized.split(":");
  const host = parts[0]?.trim();
  const port = parts[1]?.trim();

  if (!host || !port) {
    throw new Error(`Invalid proxy value: ${rawValue}`);
  }

  const username = parts[2]?.trim() || undefined;
  const password = parts[3]?.trim() || undefined;

  return {
    server: `${protocol}://${host}:${port}`,
    username,
    password
  };
}

function inferProtocolFromServer(rawServer: string) {
  if (/^socks5:\/\//i.test(rawServer)) {
    return "socks5";
  }
  return "http";
}

function normalizeProxyProtocol(value: string) {
  const protocol = value.toLowerCase();
  if (protocol === "http" || protocol === "https") {
    return "http";
  }
  if (protocol === "socks5") {
    return "socks5";
  }
  throw new Error(`Unsupported collector proxy protocol: ${value}`);
}

function normalizeBypass(value: string) {
  return value || undefined;
}

function buildProxyXoayCache(
  cacheKey: string,
  protocol: "http" | "socks5",
  settings: CollectorProxySettings,
  payload: ProxyXoayResponse
): ProxyXoayCache {
  const now = new Date();

  return {
    version: 1,
    cacheKey,
    protocol,
    settings,
    acquiredAt: now.toISOString(),
    expiresAt: resolveProxyExpiry(payload, now)?.toISOString(),
    providerMessage: payload.message,
    providerNetwork: payload["Nha Mang"],
    providerRegion: payload["Vi Tri"],
    providerTokenExpirationDate: payload["Token expiration date"]
  };
}

function resolveProxyExpiry(payload: ProxyXoayResponse, now: Date) {
  const ttlMatch = payload.message?.match(/die\s+sau\s+(\d+)s/i);
  if (ttlMatch) {
    const ttlSeconds = Number.parseInt(ttlMatch[1] || "", 10);
    if (Number.isFinite(ttlSeconds) && ttlSeconds > 0) {
      return new Date(now.getTime() + ttlSeconds * 1000);
    }
  }

  const tokenExpiration = parseProxyXoayTokenExpiration(payload["Token expiration date"]);
  if (tokenExpiration) {
    return tokenExpiration;
  }

  return null;
}

function parseProxyXoayTokenExpiration(value?: string) {
  if (!value) {
    return null;
  }

  const match = value.trim().match(/^(\d{1,2}):(\d{2})\s+(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (!match) {
    return null;
  }

  const [, hoursRaw, minutesRaw, dayRaw, monthRaw, yearRaw] = match;
  const date = new Date(
    Number.parseInt(yearRaw, 10),
    Number.parseInt(monthRaw, 10) - 1,
    Number.parseInt(dayRaw, 10),
    Number.parseInt(hoursRaw, 10),
    Number.parseInt(minutesRaw, 10),
    0,
    0
  );

  return Number.isNaN(date.getTime()) ? null : date;
}

function buildProxyXoayCacheKey(input: {
  key: string;
  protocol: "http" | "socks5";
  nhamang: string;
  tinhthanh: string;
  whitelist: string;
  bypass: string;
}) {
  return crypto
    .createHash("sha256")
    .update(
      [
        input.key,
        input.protocol,
        input.nhamang,
        input.tinhthanh,
        input.whitelist,
        input.bypass
      ].join("|")
    )
    .digest("hex");
}

async function readProxyXoayCache(cacheKey: string) {
  if (!envBool("COLLECTOR_PROXY_CACHE_ENABLED", true)) {
    return null;
  }

  try {
    const raw = await readFile(resolveProxyCachePath(), "utf8");
    const payload = JSON.parse(raw) as ProxyXoayCache;
    if (payload?.version !== 1 || payload.cacheKey !== cacheKey || !payload.settings?.server) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

async function writeProxyXoayCache(cache: ProxyXoayCache) {
  if (!envBool("COLLECTOR_PROXY_CACHE_ENABLED", true)) {
    return;
  }

  const targetPath = resolveProxyCachePath();
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, JSON.stringify(cache, null, 2), "utf8").catch(() => undefined);
}

function resolveProxyCachePath() {
  const value = envString("COLLECTOR_PROXY_CACHE_FILE", "").trim();
  return value ? path.resolve(value) : defaultProxyCachePath;
}

function isProxyCacheUsable(cache: ProxyXoayCache) {
  if (!cache.expiresAt) {
    return true;
  }

  const expiresAt = Date.parse(cache.expiresAt);
  if (!Number.isFinite(expiresAt)) {
    return true;
  }

  return Date.now() + proxyCacheExpirySkewMs < expiresAt;
}

function isProxyCacheFresh(cache: ProxyXoayCache) {
  const acquiredAt = Date.parse(cache.acquiredAt);
  if (!Number.isFinite(acquiredAt)) {
    return false;
  }

  return Date.now() - acquiredAt < proxyXoayRefreshIntervalMs;
}

function canReuseCachedProxyAfterFailure(cache: ProxyXoayCache, message: string) {
  if (isProxyCacheUsable(cache)) {
    return true;
  }

  if (!/con\s+\d+s\s+moi\s+co\s+the\s+doi\s+proxy/i.test(message)) {
    return false;
  }

  if (!cache.expiresAt) {
    return true;
  }

  const expiresAt = Date.parse(cache.expiresAt);
  if (!Number.isFinite(expiresAt)) {
    return true;
  }

  return Date.now() <= expiresAt + proxyCacheFallbackGraceMs;
}
