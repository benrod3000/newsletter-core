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

/** Send a system transactional email using the platform SendGrid key. */
export async function sendTransactionalEmail(params: {
  to: string;
  subject: string;
  text?: string;
  html?: string;
}): Promise<boolean> {
  const apiKey = process.env.SENDGRID_API_KEY;
  const fromEmail = process.env.SENDGRID_FROM_EMAIL;
  if (!apiKey || !fromEmail) {
    console.error("sendTransactionalEmail: Missing SENDGRID_API_KEY or SENDGRID_FROM_EMAIL");
    throw new Error("Transactional email provider not configured.");
  }
  return sendEmail(
    { to: params.to, from: fromEmail, subject: params.subject, text: params.text, html: params.html },
    { provider: "sendgrid", sendgridApiKey: apiKey }
  );
}
