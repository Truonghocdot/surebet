import { NextResponse } from "next/server";
import { activeOpportunitiesSeed } from "@/features/dashboard/api/mock-seed";

export async function GET() {
  return NextResponse.json(activeOpportunitiesSeed);
}

