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
 * Both of the problems this route was written to work around are now fixed, and
 * the history is worth keeping because it explains the shape of the code:
 *
 * 1. The endpoint used to return 500 unconditionally. It selected
 *    sendgrid_api_key, resend_api_key and from_email from `clients`; none of the
 *    three existed, PostgREST rejected the whole select, and every call landed in
 *    the "Could not load workspace settings" branch.
 *
 * 2. Because those columns were missing, the dispatcher's
 *    `client.sendgrid_api_key || process.env.SENDGRID_API_KEY` always resolved to
 *    the platform key. Per-workspace credentials worked for SES alone, so every
 *    SendGrid and Resend workspace shared one account and one sender reputation.
 *
 * Migration 055 adds the two key columns; `from_email` was simply deleted from
 * the select, since `sender_email` and `ses_from_email` are the real ones. The
 * workspace key now wins over the platform key, and `platform_key` reports which
 * of the two a send would actually use. The platform fallback is retained so
 * existing workspaces keep sending, but it is a migration aid, not the design.
 */
export const GET = withWorkspace(async ({ ctx }) => {
  // Deliberately the service-role client. This reads provider credentials, and
  // migration 049 withholds those columns from `authenticated` precisely so a
  // viewer cannot pull them. Authorization already happened in withWorkspace.
  const { data: client, error: fetchError } = await getSupabaseClient()
    .from("clients")
    // One string literal on purpose: supabase-js infers the row type from this
    // argument, and a concatenated string degrades it to GenericStringError,
    // which turns every field access below into a type error.
    .select("email_provider, ses_access_key, ses_secret_key, ses_region, ses_from_email, sender_email, sendgrid_api_key, resend_api_key")
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

  // SendGrid and Resend. Since migration 055 there is a per-workspace key to
  // read, and it wins; the platform env key is the fallback. Resolution order
  // here must match send-campaign.ts and dispatcher.ts exactly, or this panel
  // will cheerfully report a key that is not the one used to send.
  const isResend = provider === "resend";
  const providerLabel = isResend ? "Resend" : "SendGrid";
  const workspaceKey = isResend ? client.resend_api_key : client.sendgrid_api_key;
  const platformKey = isResend ? process.env.RESEND_API_KEY : process.env.SENDGRID_API_KEY;
  const key = workspaceKey || platformKey;

  if (!key) {
    status.missing_fields = [`${providerLabel} API Key`];
    status.configured = false;
    status.key_valid = false;
    status.sender_verified = false;
    status.details =
      `No ${providerLabel} API key is set for this workspace, and no platform ` +
      `fallback key is configured. Paste a ${providerLabel} key in Settings to start sending.`;
    return NextResponse.json(status, { headers: CORS });
  }

  // A valid key is not sufficient to send. With no sender_email the dispatcher
  // falls back to noreply@veloce.app, which is not a verified sender on the
  // workspace's own provider account, so the send is rejected at the provider
  // with an error that says nothing about this page. Reporting "connected" on
  // the strength of the key alone is how that trap gets set.
  status.sender_verified = Boolean(client.sender_email);
  if (!client.sender_email) status.missing_fields.push("Sender Email");

  status.configured = Boolean(client.sender_email);
  status.platform_key = !workspaceKey;

  const endpoint =
    provider === "resend" ? "https://api.resend.com/audiences" : "https://api.sendgrid.com/v3/api_keys";

  try {
    const res = await fetch(endpoint, { headers: { Authorization: `Bearer ${key}` } });

    // Resend keys come in two permission levels, and the one this app actually
    // wants is the narrower of the two. A "Sending access" key cannot read
    // /audiences and comes back 401 `restricted_api_key` - authentication
    // succeeded, authorisation for this particular endpoint did not. Reporting
    // that as "key rejected" would tell a correctly-configured workspace to go
    // replace a key that works, so the two cases are separated here.
    const sendOnly =
      isResend && res.status === 401 && (await res.text()).includes("restricted_api_key");
    const whose = status.platform_key
      ? `the shared platform ${providerLabel} account`
      : `this workspace's own ${providerLabel} key`;

    if (sendOnly) {
      status.key_valid = true;
      status.details = `Verified against ${whose} (send-only, which is the right scope).`;
    } else if (res.ok) {
      status.key_valid = true;
      status.details = status.platform_key
        ? `Sending uses ${whose}, not a key belonging to this workspace. Add your own key to send on your own sender reputation.`
        : `Verified against ${whose}.`;
    } else {
      status.key_valid = false;
      status.details =
        res.status === 401 || res.status === 403
          ? `${providerLabel} rejected this key (${res.status}). Check it was copied whole and has not been revoked.`
          : `${providerLabel} key check failed: ${res.status}.`;
    }
  } catch (err) {
    logError(err, { route: "clients.provider-status", workspaceId: ctx.workspaceId, provider });
    status.key_valid = null;
    status.details = `Could not reach ${providerLabel} to validate the key.`;
  }

  // Appended at the single exit rather than in each branch above, so it cannot
  // be missed by whichever path the key check happened to take.
  if (!client.sender_email) {
    status.details += " No sender email is set, so sending will fail regardless of the key.";
  }

  // A valid key plus a sender address is *still* not enough to send.
  //
  // Resend rejects any message whose From domain is not verified in the account
  // that owns the key. Measured on this project: a valid full-access key with
  // sender_email set to ben@brod3000.com, and zero verified domains - so every
  // send would have been rejected at the provider while this endpoint reported
  // a green "Verified against this workspace's own Resend key".
  //
  // That is the same false-green this file already guards against for a missing
  // sender email, one step further along. Checked last because it needs the key
  // to have proven valid first.
  if (isResend && status.key_valid && client.sender_email) {
    const domain = client.sender_email.split("@")[1]?.toLowerCase();
    const verified = await resendDomainStatus(key, domain);

    if (verified === "unverified") {
      status.configured = false;
      status.sender_verified = false;
      status.missing_fields.push("Verified sending domain");
      status.details =
        `${providerLabel} has no verified domain for ${domain}, so it will reject ` +
        `mail from ${client.sender_email}. Add and verify ${domain} in ${providerLabel}, ` +
        `which means adding the DNS records it gives you.`;
    } else if (verified === "pending") {
      status.configured = false;
      status.sender_verified = false;
      status.details =
        `${domain} is added to ${providerLabel} but not verified yet. Sending stays ` +
        `blocked until its DNS records propagate.`;
    }
    // "verified" and "unknown" both leave the existing details alone: unknown
    // means a send-only key that cannot list domains, and reporting a problem
    // we cannot actually see would be worse than saying nothing.
  }

  return NextResponse.json(status, { headers: CORS });
});

/**
 * Whether `domain` is verified in the Resend account owning this key.
 *
 * Returns "unknown" rather than guessing when the key cannot list domains: a
 * send-only key answers 401 restricted_api_key here, and that key is a
 * perfectly good sending key. Treating it as a failure would tell a correctly
 * configured workspace to go fix something that is not broken.
 */
async function resendDomainStatus(
  apiKey: string,
  domain: string | undefined
): Promise<"verified" | "pending" | "unverified" | "unknown"> {
  if (!domain) return "unknown";

  try {
    const res = await fetch("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return "unknown";

    const body = (await res.json()) as { data?: Array<{ name?: string; status?: string }> };
    const match = body.data?.find((d) => d.name?.toLowerCase() === domain);

    if (!match) return "unverified";
    return match.status === "verified" ? "verified" : "pending";
  } catch {
    // Reachability problems are already reported by the key check above.
    return "unknown";
  }
}
