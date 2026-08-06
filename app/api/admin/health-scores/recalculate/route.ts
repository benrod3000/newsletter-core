import { NextRequest, NextResponse } from "next/server";
import { recalculateHealthScores } from "@/lib/health-scores";
import { requireCronSecret } from "@/lib/cron-auth";

/**
 * This route previously had no duration set and relied on the default, which is
 * why scoring never finished: it timed out partway through and left most
 * subscribers unscored, every night, forever. The work is now batched and needs
 * far less time, but the headroom is stated rather than assumed.
 */
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const auth = requireCronSecret(req);
  if (auth) return auth;
  try {
    const result = await recalculateHealthScores();
    // A partial run is a failure even though rows were written, so it must not
    // answer 200. That was the previous behaviour and is how this stayed
    // invisible.
    const incomplete = Boolean(result.error) || result.scored !== result.total;
    return NextResponse.json(result, { status: incomplete ? 500 : 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
