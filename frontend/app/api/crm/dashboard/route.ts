import { NextResponse } from "next/server";
import { getSessionUser } from "@/features/auth/server/session";
import { filterOpportunitiesForRole } from "@/lib/opportunity-visibility";
import { fetchBackendOpportunities } from "@/lib/server-dashboard-data";

export async function GET() {
  try {
    const [user, rawOpportunities] = await Promise.all([
      getSessionUser(),
      fetchBackendOpportunities()
    ]);
    const opportunities = filterOpportunitiesForRole(rawOpportunities, user?.role);

    const uniqueFixtures = new Set(opportunities.map((item) => item.fixture_id)).size;
    const uniqueSources = new Set(
      opportunities.flatMap((item) =>
        item.legs.map((leg) => `${leg.bookmaker_id}/${leg.lobby_id}`)
      )
    ).size;
    const bestProfit =
      opportunities.length > 0
        ? Math.max(...opportunities.map((item) => item.profit_percentage))
        : 0;
    const avgProfit =
      opportunities.length > 0
        ? opportunities.reduce((sum, item) => sum + item.profit_percentage, 0) /
          opportunities.length
        : 0;
    const latestDetectedAt = opportunities
      .map((item) => item.detected_at)
      .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0];

    return NextResponse.json({
      stats: [
        {
          title: "Cơ hội hiện có",
          value: String(opportunities.length),
          delta:
            opportunities.length > 0
              ? `Trung bình ${avgProfit.toFixed(2)}%`
              : "Chưa phát hiện cơ hội",
          tone: opportunities.length > 0 ? "positive" : "neutral"
        },
        {
          title: "Lợi nhuận tốt nhất",
          value: opportunities.length > 0 ? `${bestProfit.toFixed(2)}%` : "0.00%",
          delta: opportunities.length > 0 ? "Cơ hội cao nhất hiện tại" : "Chưa có dữ liệu",
          tone: opportunities.length > 0 ? "positive" : "neutral"
        },
        {
          title: "Trận có cơ hội",
          value: String(uniqueFixtures),
          delta: "",
          tone: uniqueFixtures > 0 ? "neutral" : "warning"
        },
        {
          title: "Nhà cái tham gia",
          value: String(uniqueSources),
          delta: latestDetectedAt ? `Mới nhất ${formatFreshness(latestDetectedAt)}` : "Đang chờ phát hiện",
          tone: uniqueSources > 0 ? "positive" : "warning"
        }
      ],
      opportunities
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Không tải được dữ liệu màn hình chính."
      },
      { status: 502 }
    );
  }
}

function formatFreshness(value: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) {
    return `${seconds} giây trước`;
  }
  return `${Math.floor(seconds / 60)} phút trước`;
}
