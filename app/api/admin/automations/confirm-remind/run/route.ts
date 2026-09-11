import { NextRequest, NextResponse } from "next/server";
import { runConfirmRemind } from "@/lib/automations/confirm-remind";
import { requireCronSecret } from "@/lib/cron-auth";
import { getApiBaseUrl } from "@/lib/geo-utils";

/**
 * Sending reminder emails takes longer than flipping a flag did, so this needs a
 * duration budget. Without one it inherits the platform default and a backlog
 * would be cut off partway.
 */
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const auth = requireCronSecret(req);
  if (auth) return auth;

  // `getApiBaseUrl`, not `getBaseUrl`. The latter prefers NEXT_PUBLIC_APP_URL,
  // which on this project points at the FRONTEND - so a confirmation link built
  // from it 404s. This reads the request's own proto and host and consults no
  // env var.
  const result = await runConfirmRemind(getApiBaseUrl(req));

  // 500 on failure rather than a cheerful 200 with an error field nobody reads.
  // The health-score cron learned this: a route that answers 200 over a partial
  // run makes the failure invisible until someone goes looking.
  const status = result.error ? 500 : 200;
  return NextResponse.json(result, { status });
}
