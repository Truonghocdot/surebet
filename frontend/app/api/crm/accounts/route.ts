import { NextResponse } from "next/server";
import { fetchBackendJSON } from "@/lib/server-api";

export async function GET() {
  try {
    const payload = await fetchBackendJSON<{
      data: Array<{
        bookmaker_name: string;
        label: string;
        balance: number;
        is_enabled: boolean;
      }>;
    }>("/v1/bookmaker-accounts");

    return NextResponse.json(
      payload.data.map((item) => ({
        bookmaker: item.bookmaker_name,
        account: item.label,
        balance: `$${item.balance.toLocaleString()}`,
        status: item.is_enabled ? "Hoạt động" : "Tắt"
      }))
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Không tải được dữ liệu tài khoản."
      },
      { status: 502 }
    );
  }
}
