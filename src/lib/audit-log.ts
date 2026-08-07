import { getSupabaseClient } from "./supabase";
import { getClientIp } from "./client-ip";
import type { Json } from "./database.types";

const AUDIT_ACTIONS = {
  LOGIN: "login",
  LOGIN_FAILED: "login_failed",
  LOGOUT: "logout",
  TOTP_ENABLED: "totp_enabled",
  TOTP_DISABLED: "totp_disabled",
  TOTP_VERIFIED: "totp_verified",
  PASSWORD_CHANGED: "password_changed",
  /**
   * Both outcomes are recorded, because the request deliberately returns the
   * same response whether or not the email went out - so the log is the only
   * place the difference is visible.
   */
  PASSWORD_RESET_SENT: "password_reset_sent",
  PASSWORD_RESET_FAILED: "password_reset_failed",
  CAMPAIGN_SENT: "campaign_sent",
  CAMPAIGN_SCHEDULED: "campaign_scheduled",
  SUBSCRIBER_EXPORTED: "subscriber_exported",
  SUBSCRIBER_IMPORTED: "subscriber_imported",
  SUBSCRIBER_DELETED: "subscriber_deleted",
  API_KEY_CREATED: "api_key_created",
  SETTINGS_CHANGED: "settings_changed",
  /**
   * Distinct from SETTINGS_CHANGED on purpose. "Someone changed the sending
   * credentials" is the event an owner wants surfaced; burying it in the same
   * bucket as a logo URL change makes it unfindable.
   */
  CREDENTIALS_CHANGED: "credentials_changed",
  MEMBER_INVITED: "member_invited",
  MEMBER_REMOVED: "member_removed",
  MEMBER_ROLE_CHANGED: "member_role_changed",
  AUTOMATION_CHANGED: "automation_changed",

  /**
   * Content and audience changes. Creation and deletion are discrete events
   * worth recording; edits are not, because a draft is autosaved continuously
   * and logging every keystroke would bury everything above.
   */
  CAMPAIGN_CREATED: "campaign_created",
  CAMPAIGN_DELETED: "campaign_deleted",
  CAMPAIGN_PUBLISHED: "campaign_published",
  CAMPAIGN_TEST_SENT: "campaign_test_sent",
  SMS_SENT: "sms_sent",
  SUBSCRIBER_CREATED: "subscriber_created",
  SUBSCRIBER_TAGS_CHANGED: "subscriber_tags_changed",
  LIST_CREATED: "list_created",
  LIST_DELETED: "list_deleted",
  LIST_MEMBERS_ADDED: "list_members_added",
  WIDGET_CREATED: "widget_created",
  WIDGET_UPDATED: "widget_updated",
  WIDGET_DELETED: "widget_deleted",
  SAVED_FILTER_CREATED: "saved_filter_created",
  SAVED_FILTER_DELETED: "saved_filter_deleted",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export interface AuditLogEntry {
  workspace_id: string;
  user_id?: string;
  action: AuditAction;
  details?: Record<string, unknown>;
  ip_address?: string;
  user_agent?: string;
}

/**
 * Log an audit event to the database
 * Fire-and-forget - never throws
 */
export async function logAudit(entry: AuditLogEntry): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    await supabase.from("audit_logs").insert({
      workspace_id: entry.workspace_id,
      user_id: entry.user_id || null,
      action: entry.action,
      // Cast at the boundary rather than widening the caller-facing type: the
      // column is jsonb, `Record<string, unknown>` is what callers naturally
      // build, and anything that survives JSON.stringify is valid here. The
      // insert is inside the try, so an unserialisable value degrades to a
      // logged failure rather than breaking the operation being audited.
      details: (entry.details ?? {}) as Json,
      ip_address: entry.ip_address || null,
      user_agent: entry.user_agent || null,
    });
  } catch (err) {
    console.error("[audit-log] Failed to write entry:", err);
  }
}

/**
 * Extract IP and user agent from a NextRequest
 */
export function extractRequestMeta(req: Request): { ip: string; ua: string } {
  // Audit logging is a bystander to whatever it observes, and must never be the
  // reason that operation fails. A request object without usable headers threw
  // a TypeError here, which propagated out of the calling route and turned a
  // successful bulk delete into a 500 - the audited action had already
  // committed, so the caller saw a failure for work that was done.
  //
  // Recording "unknown" for provenance is a far better outcome than losing the
  // event and the operation together.
  try {
    return {
      ip: getClientIp(req),
      ua: req.headers.get("user-agent") || "unknown",
    };
  } catch {
    return { ip: "unknown", ua: "unknown" };
  }
}

export { AUDIT_ACTIONS };

/**
 * Record an action from inside a withWorkspace handler.
 *
 * Thin wrapper over logAudit + extractRequestMeta, which together were eight
 * lines at every call site. That friction is why most mutations went
 * uninstrumented for so long: the vocabulary existed, the table existed, and
 * adding an entry was just tedious enough to skip.
 *
 * Never throws. Audit logging observes an operation; it does not get to be the
 * reason that operation fails.
 */
export async function audit(
  req: Request,
  ctx: { workspaceId: string; userId?: string },
  action: AuditAction,
  details?: Record<string, unknown>
): Promise<void> {
  const { ip, ua } = extractRequestMeta(req);
  await logAudit({
    workspace_id: ctx.workspaceId,
    user_id: ctx.userId,
    action,
    details,
    ip_address: ip,
    user_agent: ua,
  });
}
