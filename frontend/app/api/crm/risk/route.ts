import { NextResponse } from "next/server";
import { riskCheckpointsSeed } from "@/features/dashboard/api/mock-seed";

export async function GET() {
  return NextResponse.json(riskCheckpointsSeed);
}

