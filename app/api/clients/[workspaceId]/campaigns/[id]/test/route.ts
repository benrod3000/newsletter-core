import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { withWorkspace } from "@/lib/with-workspace";
import { dispatchEmail } from "@/lib/email/dispatcher";
import { getWorkspaceSender } from "@/lib/send-campaign";
import { buildHtmlFromEditor } from "@/lib/campaign-personalization";
import { logError } from "@/lib/logger";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

/**
 * POST /api/clients/[workspaceId]/campaigns/[id]/test
 * Send one copy of a campaign to an address, so its author can see it.
 *
 * Rewritten because it could not send. Three faults, each enough on its own:
 *
 *   1. It read sender settings from a table called `branding`. No such table exists -
 *      those columns live on `clients`. The fetch returned an error object rather than
 *      an array, `Array.isArray()` was false, and `brand` was therefore always null.
 *   2. With `brand` null, the provider defaulted to "sendgrid" and the key came from
 *      `process.env.SENDGRID_API_KEY`, which has never existed in this project's
 *      environment. This is the third copy of that same dead-SendGrid bug, after
 *      sendTransactionalEmail and the confirmation email.
 *   3. It never looked at `resend_api_key` at all, so the provider this workspace
 *      actually uses could not have been selected even with the right table.
 *
 * The result was a test send that reported success and delivered nothing - the exact
 * shape this codebase keeps producing.
 *
 * It now resolves the sender through `getWorkspaceSender`, the same function the real
 * send uses, and renders through `buildHtmlFromEditor` with the workspace's branding.
 * A preview that renders differently from the campaign is worth very little; the
 * point is to see what recipients will see.
 */
export const POST = withWorkspace<{ workspaceId: string; id: string }>(
  async ({ req, params }) => {
  const { workspaceId, id } = params;

  const body = await req.json().catch(() => null);
  const email = body?.email;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Valid test email required" }, { status: 400, headers: CORS });
  }

  const supabase = getSupabaseClient();

  try {
    const { data: campaign, error: campaignError } = await supabase
      .from("campaigns")
      .select("id, title, subject, editor_html, editor_css")
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (campaignError) {
      logError(campaignError, { route: "campaigns.test", workspaceId, id });
      return NextResponse.json({ error: "Could not load the campaign." }, { status: 500, headers: CORS });
    }
    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404, headers: CORS });
    }

    // Throws when the workspace has no usable provider, which is the honest outcome:
    // a test send that cannot send must not report success.
    const { fromEmail, fromName, dispatchConfig, branding } = await getWorkspaceSender(
      supabase,
      workspaceId
    );

    const html = buildHtmlFromEditor(
      campaign.editor_html || "",
      campaign.editor_css || "",
      branding
    );

    const result = await dispatchEmail(
      {
        to: email,
        from: `${fromName} <${fromEmail}>`,
        subject: `[TEST] ${campaign.subject || campaign.title}`,
        // The real send resolves {{ unsubscribe_url }} per recipient. A test has no
        // recipient row, so the placeholder is pointed at the dashboard rather than
        // left in the markup for the author to wonder about.
        html: html.replace(/\{\{\s*unsubscribe_url\s*\}\}/g, "#test-send-no-unsubscribe"),
      },
      dispatchConfig
    );

    if (!result.success) {
      // The dispatcher reports a rejection rather than throwing, so without this the
      // route returned 200 for a message that was never accepted - which is how a
      // test send comes to "work" while nothing arrives.
      return NextResponse.json(
        { error: `The email provider rejected the test send: ${result.error ?? "unknown error"}` },
        { status: 502, headers: CORS }
      );
    }

    await supabase
      .from("campaigns")
      .update({ last_test_sent_at: new Date().toISOString(), last_test_recipient: email })
      .eq("id", id)
      .eq("workspace_id", workspaceId);

    return NextResponse.json({ ok: true }, { status: 200, headers: CORS });
  } catch (err) {
    logError(err, { route: "campaigns.test", workspaceId, id });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to send test email" },
      { status: 500, headers: CORS }
    );
  }
  },
  { minRole: "editor" }
);

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}
