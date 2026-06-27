import { NextResponse } from "next/server";
import { orderTimelineSeed } from "@/features/dashboard/api/mock-seed";

export async function GET() {
  return NextResponse.json(orderTimelineSeed);
}

