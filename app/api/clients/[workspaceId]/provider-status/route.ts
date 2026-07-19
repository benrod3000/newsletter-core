import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { getClientContextFromJWT, assertWorkspaceAccess } from "@/lib/client-context";

const CORS = { "Access-Control-Allow-Origin": "*" };

interface ProviderStatus {
  provider: string;
  configured: boolean;
  key_valid: boolean | null;
  sender_verified: boolean | null;
  missing_fields: string[];
  details: string;
}

/**
 * GET /api/clients/{workspaceId}/provider-status
 * Returns the email provider configuration status without sending an email.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  const context = getClientContextFromJWT(req);
  if (!context || !assertWorkspaceAccess(context, workspaceId)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: CORS });
  }

  const supabase = getSupabaseClient();
  const { data: client, error: fetchError } = await supabase
    .from("clients")
    .select("email_provider, sendgrid_api_key, ses_access_key, ses_secret_key, ses_region, ses_from_email, resend_api_key, sender_email, from_email")
    .eq("id", workspaceId)
    .single();

  if (fetchError || !client) {
    return NextResponse.json({ error: "Could not load workspace settings." }, { status: 500, headers: CORS });
  }

  const provider = client.email_provider || "sendgrid";
  const status: ProviderStatus = {
    provider,
    configured: false,
    key_valid: null,
    sender_verified: null,
    missing_fields: [],
    details: "",
  };

  if (provider === "resend") {
    if (!client.resend_api_key) {
      status.missing_fields = ["Resend API Key"];
      status.details = "Resend API key is not configured. Add it above and save.";
      status.configured = false;
      status.key_valid = false;
      status.sender_verified = false;
    } else {
      // Validate by attempting to list audiences (lightweight Resend API call)
      try {
        const rRes = await fetch("https://api.resend.com/audiences", {
          headers: { Authorization: `Bearer ${client.resend_api_key}` },
        });
        if (rRes.ok) {
          status.key_valid = true;
          status.configured = true;
          status.details = "Resend key is valid. Use 'Test Provider' to verify sending.";
          status.sender_verified = null;
        } else {
          status.key_valid = false;
          status.configured = true;
          status.details = `Resend key rejected: ${rRes.status}. Check your key.`;
        }
      } catch (err) {
        status.key_valid = null;
        status.configured = true;
        status.details = `Could not validate key. Check your network.`;
      }
    }
  } else if (provider === "ses") {
    const missing: string[] = [];
    if (!client.ses_access_key) missing.push("AWS Access Key");
    if (!client.ses_secret_key) missing.push("AWS Secret Key");
    if (!client.ses_from_email) missing.push("SES From Email");
    status.missing_fields = missing;
    status.configured = missing.length === 0;
    status.details = status.configured
      ? "All SES fields are filled. Use 'Test Provider' to verify."
      : `Missing: ${missing.join(", ")}.`;
    status.key_valid = status.configured; // Can't validate SES creds without sending
    status.sender_verified = status.configured;
  } else {
    // SendGrid
    if (!client.sendgrid_api_key) {
      status.missing_fields = ["SendGrid API Key"];
      status.details = "SendGrid API key is not configured. Add it above and save.";
      status.configured = false;
      status.key_valid = false;
      status.sender_verified = false;
    } else {
      // Validate the API key by calling SendGrid's GET /v3/api_keys
      try {
        const sgRes = await fetch("https://api.sendgrid.com/v3/api_keys", {
          headers: { Authorization: `Bearer ${client.sendgrid_api_key}` },
        });

        if (sgRes.ok) {
          const sgData = await sgRes.json();
          const keyId = client.sendgrid_api_key.split(".")[1]; // SG.keyId.secret
          const matched = sgData.api_keys?.find((k: any) => k.api_key_id === keyId);
          status.key_valid = true;
          status.configured = true;
          status.details = matched
            ? `SendGrid key "${matched.name}" is active.`
            : "SendGrid key is valid. Use 'Test Provider' to verify sending.";
          status.sender_verified = null; // Can't check sender verification cheaply
        } else {
          const err = await sgRes.text();
          status.key_valid = false;
          status.configured = true; // key is set but invalid
          status.details = `SendGrid key rejected: ${sgRes.status}. Check your key.`;
        }
      } catch (err: any) {
        status.key_valid = null;
        status.configured = true;
        status.details = `Could not validate key: ${err?.message || "Network error"}`;
      }
    }
  }

  return NextResponse.json(status, { headers: CORS });
}
