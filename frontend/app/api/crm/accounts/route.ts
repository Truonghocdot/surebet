import { NextResponse } from "next/server";
import { accountHealthSeed } from "@/features/dashboard/api/mock-seed";

export async function GET() {
  return NextResponse.json(accountHealthSeed);
}

