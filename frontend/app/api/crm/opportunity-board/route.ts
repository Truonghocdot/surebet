import { NextResponse } from "next/server";
import { getSessionUser } from "@/features/auth/server/session";
import { buildCurrentOpportunityBoard } from "@/lib/opportunity-board";
import { createOpportunityBoardStabilizer } from "@/lib/opportunity-board-stability";
import { filterOpportunitiesForRole } from "@/lib/opportunity-visibility";
import {
  fetchBackendOdds,
  fetchBackendOpportunities
} from "@/lib/server-dashboard-data";

export const dynamic = "force-dynamic";

const boardStabilizers = new Map<
  string,
  ReturnType<typeof createOpportunityBoardStabilizer>
>();

export async function GET() {
  try {
    const [user, odds, rawOpportunities] = await Promise.all([
      getSessionUser(),
      fetchBackendOdds(false),
      fetchBackendOpportunities()
    ]);
    const opportunities = filterOpportunitiesForRole(rawOpportunities, user?.role);
    const roleKey = user?.role ?? "anonymous";
    const stabilize = boardStabilizers.get(roleKey) ?? createOpportunityBoardStabilizer();
    boardStabilizers.set(roleKey, stabilize);
    const items = stabilize(buildCurrentOpportunityBoard(opportunities, odds));

    return NextResponse.json(
      {
        items
      },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0"
        }
      }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Không tải được bảng so sánh kèo."
      },
      { status: 502 }
    );
  }
}
