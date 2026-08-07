/**
 * email-sender.ts - unified transactional email helpers.
 *
 * All sending goes through dispatchEmail() from the dispatcher module.
 * This file is now a thin convenience layer over the canonical send path.
 */

import { dispatchEmail } from "@/lib/email/dispatcher";
import type { DispatchConfig } from "@/lib/email/dispatcher";

export type EmailProvider = "sendgrid" | "ses" | "resend";

/**
 * Narrow a free-form provider string from the database to the union.
 *
 * `clients.email_provider` is a plain text column with no CHECK constraint, so
 * the generated type is `string | null`. Falling back to "sendgrid" matches what
 * every other read of this column already does; the value is validated here
 * rather than trusted so an unrecognised provider degrades predictably instead
 * of reaching a registry lookup that returns undefined.
 */
export function asEmailProvider(value: string | null | undefined): EmailProvider {
  return value === "ses" || value === "resend" ? value : "sendgrid";
}

export interface SendEmailParams {
  to: string;
  from: string;
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string;
  listUnsubscribe?: string;
  headers?: Record<string, string>;
}

export interface ProviderConfig {
  provider: EmailProvider;
  sendgridApiKey?: string;
  sesAccessKey?: string;
  sesSecretKey?: string;
  sesRegion?: string;
  resendApiKey?: string;
}

/** Send a single email via the dispatcher. */
export async function sendEmail(
  params: SendEmailParams,
  config: ProviderConfig
): Promise<boolean> {
  const dispatchConfig: DispatchConfig = {
    provider: config.provider || "sendgrid",
    credentials: {},
  };
  if (config.sendgridApiKey) dispatchConfig.credentials.sendgrid = config.sendgridApiKey;
  if (config.resendApiKey) dispatchConfig.credentials.resend = config.resendApiKey;
  if (config.sesAccessKey) dispatchConfig.credentials.sesAccessKey = config.sesAccessKey;
  if (config.sesSecretKey) dispatchConfig.credentials.sesSecretKey = config.sesSecretKey;
  if (config.sesRegion) dispatchConfig.credentials.sesRegion = config.sesRegion;

  const result = await dispatchEmail(params, dispatchConfig);
  return result.success;
}

/**
 * Raised when platform email is not configured. Named so callers can tell a
 * misconfiguration apart from a provider rejecting a message.
 */
export class TransactionalEmailNotConfigured extends Error {
  constructor(missing: string[]) {
    super(`Platform email is not configured. Missing: ${missing.join(", ")}.`);
    this.name = "TransactionalEmailNotConfigured";
  }
}

/** Platform email credentials, or the list of what is missing. */
export function resolveTransactionalConfig():
  | { ok: true; from: string; config: ProviderConfig }
  | { ok: false; missing: string[] } {
  const resendKey = process.env.RESEND_API_KEY;
  const sendgridKey = process.env.SENDGRID_API_KEY;
  const from = process.env.TRANSACTIONAL_FROM_EMAIL || process.env.SENDGRID_FROM_EMAIL;
  const fromName = process.env.TRANSACTIONAL_FROM_NAME || "Veloce";

  const missing: string[] = [];
  if (!resendKey && !sendgridKey) missing.push("RESEND_API_KEY or SENDGRID_API_KEY");
  if (!from) missing.push("TRANSACTIONAL_FROM_EMAIL");
  if (missing.length) return { ok: false, missing };

  // Resend preferred when both are present: it is the provider this platform
  // actually uses. SENDGRID_* is still honoured so nothing regresses if it is
  // ever set.
  const config: ProviderConfig = resendKey
    ? { provider: "resend", resendApiKey: resendKey }
    : { provider: "sendgrid", sendgridApiKey: sendgridKey };

  return { ok: true, from: `${fromName} <${from}>`, config };
}

/**
 * Send a platform email: password resets, signup welcome. Not campaign mail.
 *
 * THIS HAS NEVER SENT ANYTHING. It required SENDGRID_API_KEY and
 * SENDGRID_FROM_EMAIL, neither of which has ever existed in this project's
 * Vercel environment, so it threw on its first line every time. Both callers
 * invoked it fire-and-forget with `.catch(console.error)` and then returned
 * success, so users were told a reset link was on its way and nothing was sent.
 *
 * Deliberately independent of any workspace's provider settings. Platform email
 * is from Veloce, not from a customer, and the signup welcome fires before a
 * workspace has been configured at all - so borrowing a workspace's credentials
 * would fail in exactly the case it is most needed.
 */
export async function sendTransactionalEmail(params: {
  to: string;
  subject: string;
  text?: string;
  html?: string;
}): Promise<boolean> {
  const resolved = resolveTransactionalConfig();
  if (!resolved.ok) throw new TransactionalEmailNotConfigured(resolved.missing);

  return sendEmail(
    {
      to: params.to,
      from: resolved.from,
      subject: params.subject,
      text: params.text,
      html: params.html,
    },
    resolved.config
  );
}
