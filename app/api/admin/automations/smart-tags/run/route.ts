import { NextRequest, NextResponse } from "next/server";
import { runSmartTags } from "@/lib/automations/smart-tags";
import { requireCronSecret } from "@/lib/cron-auth";

export async function GET(req: NextRequest) {
  const auth = requireCronSecret(req);
  if (auth) return auth;
  const result = await runSmartTags();
  return NextResponse.json(result, { status: 200 });
}
