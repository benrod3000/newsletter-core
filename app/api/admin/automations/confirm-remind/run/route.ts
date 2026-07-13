import { NextRequest, NextResponse } from "next/server";
import { runConfirmRemind } from "@/lib/automations/confirm-remind";

export async function GET(req: NextRequest) {
  const result = await runConfirmRemind();
  return NextResponse.json(result, { status: 200 });
}
