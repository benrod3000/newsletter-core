import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { logError } from "@/lib/logger";

/**
 * Unsubscribe by token.
 *
 * This used to `DELETE` the subscriber row. That looked like the most complete
 * possible honouring of an opt-out and was the opposite:
 *
 * - **The opt-out did not survive.** With the row gone, nothing recorded that the
 *   address had ever objected, so the next CSV import or widget submission
 *   created a fresh row with no suppression and the address was mailed again.
 *   CAN-SPAM requires an opt-out to keep being honoured, so a suppression record
 *   has to outlive the subscription.
 * - **`subscribers.suppressed` had no writer.** The column, plus
 *   `suppressed_reason` and `suppressed_at`, already existed, and the widget
 *   submit path already *reads* `suppressed` to avoid mailing someone who opted
 *   out. That guard could never fire, because the row it would have matched was
 *   deleted.
 * - **It destroyed history.** `campaign_events` and `subscriber_notes` hang off
 *   the subscriber, so every open, click and note went with it, silently
 *   rewriting past analytics.
 *
 * Setting the flag is safe for sending because `campaign_audience()` - the single
 * SQL definition shared by `count_campaign_recipients()` and
 * `enqueue_campaign_recipients()` - already filters `suppressed = false`. Verified
 * against the live schema before this change: suppressing excludes from both the
 * count shown to the operator and the recipients actually enqueued.
 *
 * A subscriber who wants their data erased has a separate path: the GDPR delete
 * in the dashboard, which is a deliberate erasure rather than a side effect of
 * clicking "unsubscribe" in a footer.
 */
async function unsubscribeByToken(token: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/.test(token)) return false;
  const supabase = getSupabaseClient();

  // Idempotent: an already-suppressed row matches and is simply rewritten, so a
  // mail client fetching this URL twice is not an error. The original
  // `suppressed_at` is preserved so the first objection stays on the record.
  const { data, error } = await supabase
    .from("subscribers")
    .update({
      suppressed: true,
      suppressed_reason: "unsubscribe",
      suppressed_at: new Date().toISOString(),
      consent_email_marketing: false,
    })
    .eq("unsubscribe_token", token)
    .is("suppressed_at", null)
    .select("id");

  if (error) {
    logError(error, { route: "unsubscribe" });
    return false;
  }

  if ((data?.length ?? 0) > 0) return true;

  // No row updated: either the token is unknown, or it was already suppressed by
  // an earlier click. Those must not be reported the same way - the second is a
  // success from the visitor's point of view.
  const { data: existing, error: readError } = await supabase
    .from("subscribers")
    .select("id")
    .eq("unsubscribe_token", token)
    .maybeSingle();

  if (readError) {
    logError(readError, { route: "unsubscribe.recheck" });
    return false;
  }

  return Boolean(existing);
}

// One-click unsubscribe per RFC 8058 / Gmail+Yahoo requirement.
// Email clients POST to this URL with no body - token is in the query string.
export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const queryToken = searchParams.get("token");

  // One-click path: token in query string (List-Unsubscribe-Post header)
  if (queryToken) {
    try {
      await unsubscribeByToken(queryToken.trim());
      return new NextResponse(null, { status: 200 });
    } catch (err) {
      logError(err, { route: "unsubscribe.one-click" });
      return new NextResponse(null, { status: 500 });
    }
  }

  // Legacy path: token in JSON body (used by the unsubscribe page form)
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body.token !== "string") {
      return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    }

    const removed = await unsubscribeByToken(body.token.trim());
    return NextResponse.json({ ok: true, removed }, { status: 200 });
  } catch (err) {
    logError(err, { route: "unsubscribe" });
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
