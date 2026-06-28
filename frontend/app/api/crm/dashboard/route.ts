import { NextResponse } from "next/server";
import {
  activeOpportunitiesSeed,
  featureFlagsSeed,
  orderTimelineSeed,
  riskCheckpointsSeed,
  statCardsSeed
} from "@/features/dashboard/api/mock-seed";
import { fetchBackendJSON } from "@/lib/server-api";

export async function GET() {
  try {
    const [bookmakerAccounts, bookmakers, configurations] = await Promise.all([
      fetchBackendJSON<{
        data: Array<{
          bookmaker_name: string;
          label: string;
          balance: number;
          is_enabled: boolean;
        }>;
      }>("/v1/bookmaker-accounts"),
      fetchBackendJSON<{ data: unknown[] }>("/v1/bookmakers"),
      fetchBackendJSON<{ data: unknown[] }>("/v1/configurations?prefix=bookmaker.")
    ]);

    return NextResponse.json({
      stats: statCardsSeed,
      opportunities: activeOpportunitiesSeed,
      orders: orderTimelineSeed,
      accounts: bookmakerAccounts.data.map((item) => ({
        bookmaker: item.bookmaker_name,
        account: item.label,
        balance: `$${item.balance.toLocaleString()}`,
        status: item.is_enabled ? "Hoạt động" : "Tắt"
      })),
      flags: featureFlagsSeed,
      bookmakers: bookmakers.data,
      configurations: configurations.data,
      risk: riskCheckpointsSeed
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
