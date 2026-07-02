import { NextResponse } from "next/server";
import { fetchBackendJSON } from "@/lib/server-api";
import {
  fetchBackendOpportunities,
  fetchDashboardAccounts
} from "@/lib/server-dashboard-data";

export async function GET() {
  try {
    const [accounts, bookmakers, configurations, opportunities, odds] = await Promise.all([
      fetchDashboardAccounts(),
      fetchBackendJSON<{ data: unknown[] }>("/v1/bookmakers"),
      fetchBackendJSON<{ data: unknown[] }>("/v1/configurations?prefix=bookmaker."),
      fetchBackendOpportunities(),
      fetchBackendJSON<{
        data: Array<{
          bookmaker_id: string;
          lobby_id: string;
          fixture_id: string;
          market_id: string;
          outcome_id: string;
          odds: number;
          available_stake: number;
          collected_at: string;
        }>;
      }>("/v1/odds")
    ]);

    const activeAccounts = accounts.filter((item) => item.status === "Hoạt động").length;
    const pendingOrders = 0;
    const totalOpportunities = opportunities.length;
    const avgProfit =
      opportunities.length > 0
        ? opportunities.reduce((sum, item) => sum + item.profit_percentage, 0) /
          opportunities.length
        : 0;

    return NextResponse.json({
      stats: [
        {
          title: "Surebet đang hoạt động",
          value: String(totalOpportunities),
          delta:
            opportunities.length > 0
              ? `TB ${avgProfit.toFixed(2)}%`
              : "Chưa có cơ hội",
          tone: opportunities.length > 0 ? "positive" : "neutral"
        },
        {
          title: "Lệnh cần xác nhận",
          value: String(pendingOrders),
          delta: "Chưa nối order engine",
          tone: "warning"
        },
        {
          title: "Account đang online",
          value: `${activeAccounts}/${accounts.length}`,
          delta: `${odds.data.length} odds hiện tại`,
          tone: activeAccounts > 0 ? "neutral" : "warning"
        },
        {
          title: "Collector feed",
          value: odds.data.length > 0 ? "LIVE" : "IDLE",
          delta: odds.data.length > 0 ? "Đang nhận dữ liệu" : "Chưa có odds",
          tone: odds.data.length > 0 ? "positive" : "warning"
        }
      ],
      opportunities,
      orders: [],
      accounts,
      flags: [],
      bookmakers: bookmakers.data,
      configurations: configurations.data,
      risk: []
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Không tải được dữ liệu dashboard."
      },
      { status: 502 }
    );
  }
}
