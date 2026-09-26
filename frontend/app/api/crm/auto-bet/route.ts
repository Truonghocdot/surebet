import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/features/auth/server/session";
import {
  autoBetControlSchema,
  collectorAccountBalanceSchema,
  type AutoBetControlSnapshot
} from "@/features/auto-bet/schemas/auto-bet-schemas";
import { backendURL } from "@/lib/server-api";

export const dynamic = "force-dynamic";

const INTERNAL_TOKEN_HEADER = "X-Surebet-Internal-Token";
const controlUpdateSchema = z.object({
  enabled: z.boolean(),
  total_stake_vnd: z.number().int().positive().max(1_000_000_000)
});

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Bạn chưa đăng nhập." }, { status: 401 });
  }

  const checkedAt = new Date().toISOString();
  const token = process.env.INTERNAL_API_TOKEN?.trim();
  if (!token) {
    return monitorResponse({
      checked_at: checkedAt,
      control: controlFromEnv(),
      balances: unavailableBalances("Frontend chÆ°a Ä‘Æ°á»£c cáº¥p INTERNAL_API_TOKEN.")
    });
  }

  const [control, balances] = await Promise.all([
    fetchControl(token),
    fetchBalances(token)
  ]);
  return monitorResponse({ checked_at: checkedAt, control, balances });
}

export async function PUT(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Bạn chưa đăng nhập." }, { status: 401 });
  }

  if (user.role !== "super_admin") {
    return NextResponse.json({ error: "Bạn không có quyền thay đổi auto-bet." }, { status: 403 });
  }

  const parsed = controlUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Tổng tiền lệnh phải là số nguyên dương." }, { status: 400 });
  }

  const token = process.env.INTERNAL_API_TOKEN?.trim();
  if (!token) {
    return NextResponse.json({ error: "Frontend chưa được cấp INTERNAL_API_TOKEN." }, { status: 503 });
  }

  try {
    const response = await fetch(backendURL("/v2/internal/auto-bet/control"), {
      method: "PUT",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        [INTERNAL_TOKEN_HEADER]: token
      },
      body: JSON.stringify(parsed.data),
      cache: "no-store",
      signal: AbortSignal.timeout(2_000)
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      return NextResponse.json(
        { error: readBackendError(payload, response.status) },
        { status: response.status }
      );
    }
    const data = payload && typeof payload === "object" && "data" in payload
      ? (payload as { data: unknown }).data
      : payload;
    const control = autoBetControlSchema.parse(data);
    return monitorResponse({
      checked_at: new Date().toISOString(),
      control,
      balances: unavailableBalances("Balance snapshot is refreshed by GET.")
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Không kết nối được backend." },
      { status: 503 }
    );
  }
}

function controlFromEnv() {
  const mode = (process.env.AUTO_BET_MODE ?? "off").trim().toLowerCase();
  const parsed = Number(process.env.AUTO_BET_TOTAL_STAKE_VND ?? "100000");
  const total = Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 100_000;
  return {
    enabled: mode === "simulation" || mode === "dry-run" || mode === "live",
    total_stake_vnd: total,
    updated_at: new Date(0).toISOString()
  } satisfies AutoBetControlSnapshot["control"];
}

async function fetchControl(token: string) {
  try {
    const response = await fetch(backendURL("/v2/internal/auto-bet/control"), {
      headers: { Accept: "application/json", [INTERNAL_TOKEN_HEADER]: token },
      cache: "no-store",
      signal: AbortSignal.timeout(2_000)
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(readBackendError(payload, response.status));
    }
    const data = payload && typeof payload === "object" && "data" in payload
      ? (payload as { data: unknown }).data
      : payload;
    return autoBetControlSchema.parse(data);
  } catch {
    return controlFromEnv();
  }
}

async function fetchBalances(token: string) {
  try {
    const response = await fetch(backendURL("/v2/internal/account-balances"), {
      headers: { Accept: "application/json", [INTERNAL_TOKEN_HEADER]: token },
      cache: "no-store",
      signal: AbortSignal.timeout(2_000)
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(readBackendError(payload, response.status));
    }
    const data = payload && typeof payload === "object" && "data" in payload
      ? (payload as { data: { items?: unknown[]; server_time?: string; stale_after_seconds?: number } }).data
      : null;
    if (!data || !Array.isArray(data.items)) {
      throw new Error("Backend khÃ´ng tráº£ vá» dá»¯ liá»‡u sá»‘ dÆ° há»£p lá»‡.");
    }
    const items = data.items.map((item) => collectorAccountBalanceSchema.parse(item));
    return {
      state: "available" as const,
      items,
      server_time: data.server_time,
      stale_after_seconds: data.stale_after_seconds
    };
  } catch (error) {
    return unavailableBalances(error instanceof Error ? error.message : "KhÃ´ng Ä‘á»c Ä‘Æ°á»£c sá»‘ dÆ°.");
  }
}

function unavailableBalances(error: string) {
  return {
    state: "unavailable" as const,
    items: [],
    error
  };
}

function readBackendError(payload: unknown, status: number) {
  if (payload && typeof payload === "object" && "error" in payload) {
    return String((payload as { error: unknown }).error);
  }
  return `Backend auto-bet trả về HTTP ${status}.`;
}

function monitorResponse(snapshot: AutoBetControlSnapshot) {
  return NextResponse.json(snapshot, {
    headers: { "Cache-Control": "no-store, max-age=0" }
  });
}
