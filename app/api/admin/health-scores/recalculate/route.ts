import { NextRequest, NextResponse } from "next/server";
import { recalculateHealthScores } from "@/lib/health-scores";
import { requireCronSecret } from "@/lib/cron-auth";

export async function GET(req: NextRequest) {
  const auth = requireCronSecret(req);
  if (auth) return auth;
  try {
    const result = await recalculateHealthScores();
    return NextResponse.json(result, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
