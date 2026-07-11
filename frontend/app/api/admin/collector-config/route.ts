import { NextResponse } from "next/server";
import { getAccessToken, getSessionUser } from "@/features/auth/server/session";
import { backendURL } from "@/lib/server-api";

export async function GET() {
  const denied = await ensureSuperAdmin();
  if (denied) {
    return denied;
  }

  return forward("GET");
}

export async function PUT(request: Request) {
  const denied = await ensureSuperAdmin();
  if (denied) {
    return denied;
  }

  return forward("PUT", await request.text());
}

async function forward(method: "GET" | "PUT", body?: string) {
  const token = await getAccessToken();

  try {
    const response = await fetch(backendURL("/v1/admin/collector-config"), {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body,
      cache: "no-store"
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      return NextResponse.json(
        {
          error:
            payload && typeof payload === "object" && "error" in payload
              ? String(payload.error)
              : "Không xử lý được collector config."
        },
        { status: response.status }
      );
    }

    return NextResponse.json((payload as { data: unknown }).data);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Không xử lý được collector config."
      },
      { status: 502 }
    );
  }
}

async function ensureSuperAdmin() {
  const user = await getSessionUser();
  const token = await getAccessToken();

  if (!user || !token) {
    return NextResponse.json({ error: "Bạn chưa đăng nhập." }, { status: 401 });
  }
  if (user.role !== "super_admin") {
    return NextResponse.json({ error: "Không đủ quyền truy cập." }, { status: 403 });
  }

  return null;
}
