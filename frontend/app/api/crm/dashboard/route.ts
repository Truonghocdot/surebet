import { NextResponse } from "next/server";
import {
  accountHealthSeed,
  activeOpportunitiesSeed,
  featureFlagsSeed,
  orderTimelineSeed,
  statCardsSeed
} from "@/features/dashboard/api/mock-seed";

export async function GET() {
  return NextResponse.json({
    stats: statCardsSeed,
    opportunities: activeOpportunitiesSeed,
    orders: orderTimelineSeed,
    accounts: accountHealthSeed,
    flags: featureFlagsSeed
  });
}

