import { NextResponse } from "next/server";
import { backendURL, fetchBackendJSON } from "@/lib/server-api";

export async function GET() {
  try {
    const payload = await fetchBackendJSON<{
      data: Array<{
        bookmaker_code: string;
        bookmaker_name: string;
        url: string;
        username: string;
        password: string;
      }>;
    }>("/v1/bookmaker-settings");

    return NextResponse.json({
      data: payload.data.filter(
        (item) => item.bookmaker_code === "8xbet" || item.bookmaker_code === "jun88"
      )
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Không tải được dữ liệu cấu hình bookmaker."
      },
      { status: 502 }
    );
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const response = await fetch(backendURL("/v1/bookmaker-settings"), {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      cache: "no-store"
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      return NextResponse.json(
        {
          error:
            payload && typeof payload === "object" && "error" in payload
              ? String(payload.error)
              : "Không lưu được cấu hình bookmaker."
        },
        { status: response.status }
      );
    }

    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Không lưu được cấu hình bookmaker."
      },
      { status: 500 }
    );
  }
}
