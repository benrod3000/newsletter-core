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
  CAMPAIGN_SENT: "campaign_sent",
  CAMPAIGN_SCHEDULED: "campaign_scheduled",
  SUBSCRIBER_EXPORTED: "subscriber_exported",
  SUBSCRIBER_IMPORTED: "subscriber_imported",
  SUBSCRIBER_DELETED: "subscriber_deleted",
  API_KEY_CREATED: "api_key_created",
  SETTINGS_CHANGED: "settings_changed",
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
  const ip = getClientIp(req);
  const ua = req.headers.get("user-agent") || "unknown";
  return { ip, ua };
}

export { AUDIT_ACTIONS };
