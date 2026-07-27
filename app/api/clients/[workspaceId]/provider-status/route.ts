import { NextResponse } from "next/server";
import { withWorkspace } from "@/lib/with-workspace";
import { getSupabaseClient } from "@/lib/supabase";
import { logError } from "@/lib/logger";

const CORS = { "Access-Control-Allow-Origin": "*" };

interface ProviderStatus {
  provider: string;
  configured: boolean;
  key_valid: boolean | null;
  sender_verified: boolean | null;
  missing_fields: string[];
  details: string;
  /** True when the key in use belongs to the platform, not this workspace. */
  platform_key: boolean;
}

/**
 * GET /api/clients/{workspaceId}/provider-status
 * Reports email provider configuration without sending anything.
 *
 * TWO PRE-EXISTING PROBLEMS, both surfaced while converting this route:
 *
 * 1. This endpoint has always returned 500. It selected sendgrid_api_key,
 *    resend_api_key and from_email from `clients`, and none of those columns
 *    exist. PostgREST rejected the select, `fetchError` was set, and every call
 *    fell into the "Could not load workspace settings" branch.
 *
 * 2. The reason they do not exist is more interesting than the 500. The
 *    dispatcher reads `client.sendgrid_api_key || process.env.SENDGRID_API_KEY`
 *    (and the same for Resend), so with the column absent it ALWAYS falls back to
 *    the platform key. Per-workspace provider credentials only actually work for
 *    SES. Every SendGrid and Resend workspace sends through one shared account
 *    and therefore one shared sender reputation - one tenant's spam complaints
 *    land on everyone.
 *
 * That is a Connection-entity problem (ARCHITECTURE.md section 2) and a Phase 2
 * fix, not something to paper over here. What this route does now is report the
 * truth: it reads the columns that exist, and says plainly when the key in use is
 * the platform's rather than the workspace's.
 */
export const GET = withWorkspace(async ({ ctx }) => {
  // Deliberately the service-role client. This reads provider credentials, and
  // migration 049 withholds those columns from `authenticated` precisely so a
  // viewer cannot pull them. Authorization already happened in withWorkspace.
  const { data: client, error: fetchError } = await getSupabaseClient()
    .from("clients")
    .select("email_provider, ses_access_key, ses_secret_key, ses_region, ses_from_email, sender_email")
    .eq("id", ctx.workspaceId)
    .maybeSingle();

  if (fetchError || !client) {
    logError(fetchError ?? new Error("workspace not found"), {
      route: "clients.provider-status",
      workspaceId: ctx.workspaceId,
    });
    return NextResponse.json(
      { error: "Could not load workspace settings." },
      { status: 500, headers: CORS }
    );
  }

  const provider = client.email_provider || "sendgrid";
  const status: ProviderStatus = {
    provider,
    configured: false,
    key_valid: null,
    sender_verified: null,
    missing_fields: [],
    details: "",
    platform_key: false,
  };

  if (provider === "ses") {
    const missing: string[] = [];
    if (!client.ses_access_key) missing.push("AWS Access Key");
    if (!client.ses_secret_key) missing.push("AWS Secret Key");
    if (!client.ses_from_email) missing.push("SES From Email");

    status.missing_fields = missing;
    status.configured = missing.length === 0;
    status.details = status.configured
      ? "All SES fields are filled. Use 'Test Provider' to verify."
      : `Missing: ${missing.join(", ")}.`;
    // SES credentials cannot be validated without attempting a send.
    status.key_valid = status.configured;
    status.sender_verified = status.configured;
    return NextResponse.json(status, { headers: CORS });
  }

  // SendGrid and Resend: there is no per-workspace key to read, so whatever is
  // configured platform-wide is what this workspace will send with.
  const platformKey =
    provider === "resend" ? process.env.RESEND_API_KEY : process.env.SENDGRID_API_KEY;
  const providerLabel = provider === "resend" ? "Resend" : "SendGrid";

  if (!platformKey) {
    status.missing_fields = [`${providerLabel} API Key`];
    status.configured = false;
    status.key_valid = false;
    status.sender_verified = false;
    status.details = `No ${providerLabel} key is configured for this platform.`;
    return NextResponse.json(status, { headers: CORS });
  }

  status.configured = true;
  status.platform_key = true;

  const endpoint =
    provider === "resend" ? "https://api.resend.com/audiences" : "https://api.sendgrid.com/v3/api_keys";

  try {
    const res = await fetch(endpoint, { headers: { Authorization: `Bearer ${platformKey}` } });
    status.key_valid = res.ok;
    status.details = res.ok
      ? `Sending uses the shared platform ${providerLabel} account, not a key belonging to this workspace.`
      : `${providerLabel} key rejected: ${res.status}.`;
  } catch (err) {
    logError(err, { route: "clients.provider-status", workspaceId: ctx.workspaceId, provider });
    status.key_valid = null;
    status.details = `Could not reach ${providerLabel} to validate the key.`;
  }

  return NextResponse.json(status, { headers: CORS });
});
