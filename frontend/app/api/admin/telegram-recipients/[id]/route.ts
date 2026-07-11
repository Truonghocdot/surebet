import { NextResponse } from "next/server";
import { getAccessToken, getSessionUser } from "@/features/auth/server/session";
import { backendURL } from "@/lib/server-api";

type Context = {
  params: Promise<{
    id: string;
  }>;
};

export async function PUT(request: Request, context: Context) {
  const denied = await ensureSuperAdmin();
  if (denied) {
    return denied;
  }

  const { id } = await context.params;
  const token = await getAccessToken();

  try {
    const response = await fetch(backendURL(`/v1/admin/telegram-recipients/${id}`), {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: await request.text(),
      cache: "no-store"
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      return NextResponse.json(
        {
          error:
            payload && typeof payload === "object" && "error" in payload
              ? String(payload.error)
              : "Không cập nhật được recipient."
        },
        { status: response.status }
      );
    }
    return NextResponse.json((payload as { data: unknown }).data);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Không cập nhật được recipient."
      },
      { status: 502 }
    );
  }
}

export async function DELETE(_request: Request, context: Context) {
  const denied = await ensureSuperAdmin();
  if (denied) {
    return denied;
  }

  const { id } = await context.params;
  const token = await getAccessToken();

  try {
    const response = await fetch(backendURL(`/v1/admin/telegram-recipients/${id}`), {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`
      },
      cache: "no-store"
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      return NextResponse.json(
        {
          error:
            payload && typeof payload === "object" && "error" in payload
              ? String(payload.error)
              : "Không xóa được recipient."
        },
        { status: response.status }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Không xóa được recipient."
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
