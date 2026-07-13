import { NextRequest, NextResponse } from "next/server";
import { runSmartTags } from "@/lib/automations/smart-tags";

export async function GET(req: NextRequest) {
  const result = await runSmartTags();
  return NextResponse.json(result, { status: 200 });
}
