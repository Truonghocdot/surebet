import { NextResponse } from "next/server";
import { fetchDashboardAccounts } from "@/lib/server-dashboard-data";

export async function GET() {
  try {
    return NextResponse.json(await fetchDashboardAccounts());
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
