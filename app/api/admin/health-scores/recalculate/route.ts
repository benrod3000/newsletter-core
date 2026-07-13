import { NextRequest, NextResponse } from "next/server";
import { recalculateHealthScores } from "@/lib/health-scores";

export async function GET(req: NextRequest) {
  try {
    const result = await recalculateHealthScores();
    return NextResponse.json(result, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
