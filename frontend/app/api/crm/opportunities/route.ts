import { NextResponse } from "next/server";
import { fetchBackendOpportunities } from "@/lib/server-dashboard-data";

export async function GET() {
  try {
    return NextResponse.json(await fetchBackendOpportunities());
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Không tải được dữ liệu cơ hội."
      },
      { status: 502 }
    );
  }
}
