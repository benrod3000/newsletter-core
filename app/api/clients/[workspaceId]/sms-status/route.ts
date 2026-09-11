import { NextResponse } from "next/server";
import { withWorkspace } from "@/lib/with-workspace";
import { getSupabaseClient } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import { smsRegistry } from "@/lib/sms/registry";

const CORS = { "Access-Control-Allow-Origin": "*" };

interface SmsStatus {
  configured: boolean;
  /** Twilio accepted the account SID and auth token. */
  credentials_valid: boolean | null;
  /** The sender number exists on the account AND can send SMS. */
  sender_usable: boolean | null;
  missing_fields: string[];
  details: string;
  /** Sending is off platform-wide regardless of this workspace's configuration. */
  feature_enabled: boolean;
}

/**
 * GET /api/clients/{workspaceId}/sms-status
 *
 * Reports SMS configuration without sending anything.
 *
 * The design of this route is a direct response to what happened with Resend,
 * where "is it configured" was answered wrongly three times in a row, each
 * answer looking like proof:
 *
 *   1. The key is present. It was, and sends still failed.
 *   2. The key is valid. It was, and sends still failed.
 *   3. The sender address is set. It was. The DOMAIN was unverified, so the
 *      provider rejected every message while the UI showed green.
 *
 * The lesson is that credential validity is not sending capability. So this does
 * not stop at authenticating: it asks Twilio whether the specific sender number
 * exists on the account and whether it is SMS capable, because an account can
 * authenticate perfectly and hold a number that cannot send a text, and the
 * failure then arrives per message as error 21606.
 *
 * What it deliberately does NOT claim is 10DLC registration status. That is a
 * real gate - unregistered US A2P traffic is filtered by carriers rather than
 * rejected, so it fails silently and looks like a delivery problem - but it is
 * not readable from the messaging API this uses. Reporting a green status that
 * silently excludes the most likely reason for failure would be the same false
 * green in a new costume, so the response says plainly that it was not checked.
 */
export const GET = withWorkspace(async ({ ctx }) => {
  // Service-role deliberately: this reads provider credentials, and migration
  // 049 withholds those columns from `authenticated` so a viewer cannot pull
  // them. Authorization already happened in withWorkspace.
  const supabase = getSupabaseClient();

  const { data: client, error } = await supabase
    .from("clients")
    .select("sandbox_mode, twilio_account_sid, twilio_auth_token, twilio_phone_number")
    .eq("id", ctx.workspaceId)
    .maybeSingle();

  if (error || !client) {
    logError(error ?? new Error("workspace not found"), {
      route: "clients.sms-status",
      workspaceId: ctx.workspaceId,
    });
    return NextResponse.json({ error: "Could not load workspace settings" }, { status: 500, headers: CORS });
  }

  const featureEnabled = process.env.SMS_ENABLED === "true";

  const missing: string[] = [];
  if (!client.twilio_account_sid) missing.push("twilio_account_sid");
  if (!client.twilio_auth_token) missing.push("twilio_auth_token");
  if (!client.twilio_phone_number) missing.push("twilio_phone_number");

  if (missing.length > 0) {
    const status: SmsStatus = {
      configured: false,
      credentials_valid: null,
      sender_usable: null,
      missing_fields: missing,
      details: "Add your Twilio account SID, auth token and sender number in Settings.",
      feature_enabled: featureEnabled,
    };
    return NextResponse.json(status, { headers: CORS });
  }

  const transport = smsRegistry.resolve("twilio", {
    twilioAccountSid: client.twilio_account_sid ?? undefined,
    twilioAuthToken: client.twilio_auth_token ?? undefined,
    twilioPhoneNumber: client.twilio_phone_number ?? undefined,
  });

  if (!transport) {
    const status: SmsStatus = {
      configured: false,
      credentials_valid: null,
      sender_usable: null,
      missing_fields: missing,
      details: "Twilio transport could not be constructed from the stored credentials.",
      feature_enabled: featureEnabled,
    };
    return NextResponse.json(status, { headers: CORS });
  }

  const health = await transport.health();

  // The health check answers both questions at once, so the two flags are
  // separated by reading what it complained about. Being specific matters: "your
  // number cannot send SMS" and "your auth token is wrong" need completely
  // different actions, and a single red light sends the operator to the wrong one.
  const authFailed = health.lastError?.includes("account SID or auth token") ?? false;

  const status: SmsStatus = {
    configured: true,
    credentials_valid: health.healthy ? true : !authFailed,
    sender_usable: health.healthy,
    missing_fields: [],
    details: health.healthy
      ? "Twilio credentials work and the sender number can send SMS. 10DLC registration is not checked here and is required before US carriers will deliver reliably."
      : health.lastError ?? "Twilio rejected the configuration.",
    feature_enabled: featureEnabled,
  };

  return NextResponse.json(status, { headers: CORS });
}, { minRole: "viewer" });
