import { NextRequest, NextResponse } from "next/server";
import { runConfirmRemind } from "@/lib/automations/confirm-remind";
import { requireCronSecret } from "@/lib/cron-auth";

export async function GET(req: NextRequest) {
  const auth = requireCronSecret(req);
  if (auth) return auth;
  const result = await runConfirmRemind();
  return NextResponse.json(result, { status: 200 });
}
