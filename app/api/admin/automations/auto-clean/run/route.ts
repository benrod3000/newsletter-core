import { NextRequest, NextResponse } from "next/server";
import { runAutoClean } from "@/lib/automations/auto-clean";

export async function GET(req: NextRequest) {
  const result = await runAutoClean();
  return NextResponse.json(result, { status: 200 });
}
