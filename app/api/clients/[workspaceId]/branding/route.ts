import { withWorkspace } from "@/lib/with-workspace";
import { getSupabaseClient } from "@/lib/supabase";
import { apiSuccess, apiError, apiNotFound, apiInternalError } from "@/lib/api-response";
import { logError } from "@/lib/logger";

/**
 * Branding and provider settings.
 *
 * PRE-EXISTING BREAKAGE, found while converting: the select list named
 * resend_api_key and sendgrid_api_key, and neither column exists on `clients`.
 * PostgREST rejected the select, the result was not an array, and GET returned
 * 404 "Workspace not found" every single time. PUT had the same two fields in its
 * allowlist, so saving settings failed outright whenever either input was filled.
 *
 * The Settings page offers per-workspace SendGrid and Resend key inputs, and the
 * dispatcher reads client.sendgrid_api_key, so per-workspace keys are clearly the
 * intended design - the columns were simply never added. Adding them is a
 * decision about where provider credentials live (the Connection entity,
 * ARCHITECTURE.md section 2), so it is flagged rather than done here. Until then
 * those two inputs cannot persist anything.
 */

/** Columns that exist and are safe to return. */
const READABLE_FIELDS =
  "id,logo_url,brand_colors,custom_domain,sender_name,sender_email," +
  "email_provider,ses_region,ses_from_email,fallback_provider,sandbox_mode," +
  "twilio_account_sid,twilio_phone_number";

/**
 * Secrets. Never returned, and an empty value on write means "leave unchanged"
 * rather than "clear it".
 *
 * That second rule is load-bearing. The Settings page initialises these inputs to
 * "" and PUTs the whole object back, so returning them and then accepting a blank
 * would let simply opening the page and pressing Save wipe the workspace's
 * sending credentials.
 */
const SECRET_FIELDS = ["ses_access_key", "ses_secret_key", "twilio_auth_token"] as const;

/** Non-secret columns a caller may write. */
const WRITABLE_FIELDS = [
  "logo_url", "brand_colors", "custom_domain", "sender_name", "sender_email",
  "email_provider", "fallback_provider", "ses_region", "ses_from_email",
  "twilio_account_sid", "twilio_phone_number",
] as const;

export const GET = withWorkspace(async ({ ctx }) => {
  // Service-role: this reads credential columns to report whether they are set,
  // and migration 049 withholds them from `authenticated` by design.
  const { data, error } = await getSupabaseClient()
    .from("clients")
    .select(`${READABLE_FIELDS},${SECRET_FIELDS.join(",")}`)
    .eq("id", ctx.workspaceId)
    .maybeSingle();

  if (error) {
    logError(error, { route: "clients.branding.get", workspaceId: ctx.workspaceId });
    return apiInternalError();
  }
  if (!data) return apiNotFound("Workspace");

  // Report presence, never the value. A viewer opening Settings previously would
  // have received twilio_auth_token in the response body.
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if ((SECRET_FIELDS as readonly string[]).includes(key)) {
      result[`has_${key}`] = Boolean(value);
    } else {
      result[key] = value;
    }
  }

  return apiSuccess(result);
});

export const PUT = withWorkspace(
  async ({ req, ctx }) => {
    const body = await req.json().catch(() => null);
    if (!body) return apiError(400, "BAD_REQUEST", "Invalid JSON body");

    const updateData: Record<string, unknown> = {};

    for (const f of WRITABLE_FIELDS) {
      if (body[f] !== undefined) updateData[f] = body[f];
    }

    for (const f of SECRET_FIELDS) {
      // Only write a secret when a non-empty value was actually supplied.
      if (typeof body[f] === "string" && body[f].trim()) {
        updateData[f] = body[f].trim();
      }
    }

    if (Object.keys(updateData).length === 0) {
      return apiError(400, "BAD_REQUEST", "No settings to update");
    }

    const { data, error } = await getSupabaseClient()
      .from("clients")
      .update(updateData)
      .eq("id", ctx.workspaceId)
      .select(READABLE_FIELDS)
      .single();

    if (error) {
      if (error.code === "23505") {
        return apiError(409, "CONFLICT", "Custom domain already in use");
      }
      logError(error, { route: "clients.branding.put", workspaceId: ctx.workspaceId });
      return apiInternalError("Failed to update branding");
    }

    return apiSuccess(data);
  },
  { minRole: "owner" }
);
