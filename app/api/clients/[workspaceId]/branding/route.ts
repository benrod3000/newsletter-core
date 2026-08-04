import { withWorkspace } from "@/lib/with-workspace";
import { getSupabaseClient } from "@/lib/supabase";
import { apiSuccess, apiError, apiNotFound, apiInternalError } from "@/lib/api-response";
import { logError } from "@/lib/logger";
import type { TablesUpdate } from "@/lib/database.types";
import { logAudit, extractRequestMeta, AUDIT_ACTIONS } from "@/lib/audit-log";
import { safeColor, safeLogoUrl } from "@/lib/branding";

/**
 * Branding and provider settings.
 *
 * Migration 055 added clients.sendgrid_api_key and clients.resend_api_key, so the
 * per-workspace key inputs the Settings page has always shown now persist. Before
 * it, those two fields were absent from the allowlist below and were silently
 * dropped on write, while the endpoint still answered 200 and the UI still said
 * "Branding updated successfully!".
 *
 * They are SECRET_FIELDS, not WRITABLE_FIELDS. That buys three things: the value
 * is never returned (only has_sendgrid_api_key / has_resend_api_key), an empty
 * string means "leave unchanged" rather than "clear", and the columns stay
 * withheld from `authenticated` at the database level.
 *
 * Clearing a saved key therefore cannot be done by blanking the input. That is
 * deliberate - see the SECRET_FIELDS note below - and is why sending falls back
 * to the platform env key only when the column is genuinely null.
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
const SECRET_FIELDS = [
  "ses_access_key",
  "ses_secret_key",
  "twilio_auth_token",
  "sendgrid_api_key",
  "resend_api_key",
] as const;

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

    // Validated on write as well as on read.
    //
    // resolveBranding() already falls back on anything unusable, so a bad value
    // cannot reach rendered HTML either way. The reason to check here too is
    // feedback: silently storing "rebeccapurple" and then quietly rendering
    // amber is precisely the "I set it and nothing happened" experience these
    // fields had for their entire existence.
    if (body.brand_colors !== undefined) {
      const colors = body.brand_colors;
      if (colors === null || typeof colors !== "object" || Array.isArray(colors)) {
        return apiError(400, "BAD_REQUEST", "brand_colors must be an object");
      }
      for (const key of ["primary", "secondary"] as const) {
        const value = (colors as Record<string, unknown>)[key];
        if (value !== undefined && safeColor(value, "") === "") {
          return apiError(400, "BAD_REQUEST", `brand_colors.${key} must be a hex colour like #ff8800`);
        }
      }
    }

    if (body.logo_url !== undefined && body.logo_url !== null && body.logo_url !== "") {
      if (!safeLogoUrl(body.logo_url)) {
        return apiError(400, "BAD_REQUEST", "logo_url must be an https URL");
      }
    }

    for (const f of WRITABLE_FIELDS) {
      if (body[f] !== undefined) updateData[f] = body[f];
    }

    for (const f of SECRET_FIELDS) {
      // Three distinct inputs, because two of them used to be one:
      //   "value"    -> set it
      //   "" or absent -> leave unchanged
      //   null       -> clear it
      //
      // The empty-means-unchanged rule exists so that opening Settings, which
      // initialises every secret input to "", and pressing Save cannot wipe a
      // workspace's sending credentials. That rule also made a saved key
      // impossible to remove, which matters for the provider keys specifically:
      // clearing one is how a workspace falls back to the platform key, and how
      // a leaked key gets revoked. An explicit null is unambiguous and cannot be
      // produced by an untouched form field.
      if (body[f] === null) {
        updateData[f] = null;
      } else if (typeof body[f] === "string" && body[f].trim()) {
        updateData[f] = body[f].trim();
      }
    }

    if (Object.keys(updateData).length === 0) {
      return apiError(400, "BAD_REQUEST", "No settings to update");
    }

    const { data, error } = await getSupabaseClient()
      .from("clients")
      // Cast, not a widened type: the runtime guarantee here is the field
      // allowlist above, which is stricter than the column type. Building
      // the payload by dynamic key is what loses the type, so it is
      // reasserted at the one point it reaches the database.
      .update(updateData as TablesUpdate<"clients">)
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

    // Which fields changed, never their values: this table holds the sending
    // credentials, and an audit log that quotes a secret has just moved the
    // secret somewhere with weaker access control than the column it came from.
    // Names alone answer the question an owner is actually asking, which is
    // "who touched the provider keys, and when".
    const changed = Object.keys(updateData);
    const credentialFields = changed.filter((f) =>
      (SECRET_FIELDS as readonly string[]).includes(f)
    );

    const { ip, ua } = extractRequestMeta(req);
    await logAudit({
      workspace_id: ctx.workspaceId,
      user_id: ctx.userId,
      action: credentialFields.length ? AUDIT_ACTIONS.CREDENTIALS_CHANGED : AUDIT_ACTIONS.SETTINGS_CHANGED,
      details: {
        fields: changed,
        credentials: credentialFields,
        cleared: credentialFields.filter((f) => updateData[f] === null),
      },
      ip_address: ip,
      user_agent: ua,
    });

    return apiSuccess(data);
  },
  { minRole: "owner" }
);
