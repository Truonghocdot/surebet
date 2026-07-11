export function backendWebSocketURL(path = "/v1/ws") {
  const explicitURL = process.env.NEXT_PUBLIC_BACKEND_WS_URL;
  if (explicitURL) {
    return normalizeWebSocketURL(explicitURL, path);
  }

  const publicAPIURL = process.env.NEXT_PUBLIC_BACKEND_API_URL;
  if (publicAPIURL) {
    return normalizeWebSocketURL(publicAPIURL, path);
  }

  if (typeof window === "undefined") {
    return path;
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host =
    window.location.port === "3000"
      ? `${window.location.hostname}:8080`
      : window.location.host;

  return `${protocol}//${host}${path}`;
}

function normalizeWebSocketURL(value: string, path: string) {
  const trimmed = value.replace(/\/+$/, "");
  const withProtocol = trimmed
    .replace(/^http:\/\//, "ws://")
    .replace(/^https:\/\//, "wss://");

  if (withProtocol.endsWith(path)) {
    return withProtocol;
  }

  return `${withProtocol}${path}`;
}
