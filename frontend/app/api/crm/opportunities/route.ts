import { NextResponse } from "next/server";
import { getSessionUser } from "@/features/auth/server/session";
import { filterOpportunitiesForRole } from "@/lib/opportunity-visibility";
import { fetchBackendOpportunities } from "@/lib/server-dashboard-data";

export async function GET() {
  try {
    const [user, opportunities] = await Promise.all([
      getSessionUser(),
      fetchBackendOpportunities()
    ]);
    return NextResponse.json(filterOpportunitiesForRole(opportunities, user?.role));
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
