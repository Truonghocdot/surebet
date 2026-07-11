const backendBaseURL =
  process.env.BACKEND_API_URL?.replace(/\/+$/, "") ?? "http://127.0.0.1:8080";

export function backendURL(path: string) {
  if (path.startsWith("/")) {
    return `${backendBaseURL}${path}`;
  }

  return `${backendBaseURL}/${path}`;
}

export async function fetchBackendJSON<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(backendURL(path), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    },
    cache: "no-store"
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String(payload.error)
        : "Yêu cầu tới hệ thống thất bại.";
    throw new Error(message);
  }

  return payload as T;
}
