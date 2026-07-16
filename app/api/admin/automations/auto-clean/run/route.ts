import { NextRequest, NextResponse } from "next/server";
import { runAutoClean } from "@/lib/automations/auto-clean";
import { requireCronSecret } from "@/lib/cron-auth";

export async function GET(req: NextRequest) {
  const auth = requireCronSecret(req);
  if (auth) return auth;
  const result = await runAutoClean();
  return NextResponse.json(result, { status: 200 });
}
