import { NextResponse } from "next/server";

/**
 * Server-side feature flags.
 *
 * Read at call time rather than module load, so flipping the variable takes
 * effect on the next request in a long-lived process instead of at cold start.
 */

/**
 * SMS sending, off unless SMS_ENABLED=true.
 *
 * The email path is a durable queue: per-recipient rows, a FOR UPDATE SKIP
 * LOCKED claim, consent and suppression re-checked at dispatch, a recovery job
 * for interrupted drains. The SMS path shares none of that. It sends in a `for`
 * loop inside the request handler, caps the audience at 500 rows without
 * reporting it, writes no job and no per-recipient state, records no
 * campaign_events, and has no idempotency key anywhere - so a timeout partway
 * through leaves nothing that knows who was already texted, and a retry texts
 * them again.
 *
 * Disabled server-side as well as in the UI on purpose. A flag that only hides
 * buttons still leaves the endpoint reachable by anyone with a session token and
 * curl, and "we hid the button" is not a property you can rely on when the
 * failure mode is messaging real people twice.
 *
 * The next SMS work should be routing it through enqueueCampaignJob and
 * drainCampaignJob with a channel discriminator - not improving the fork.
 */
export function smsEnabled(): boolean {
  return process.env.SMS_ENABLED === "true";
}

/**
 * 503 rather than 404: the capability exists and is deliberately off, which is
 * a different thing from a route that was never built, and the difference
 * matters to whoever is reading the response at 2am.
 */
export function smsDisabledResponse() {
  return NextResponse.json(
    {
      error: {
        code: "FEATURE_DISABLED",
        message:
          "SMS sending is disabled. It is being moved onto the same durable delivery " +
          "pipeline email uses; until then it cannot guarantee a message is sent once.",
      },
    },
    { status: 503, headers: { "Access-Control-Allow-Origin": "*" } }
  );
}
