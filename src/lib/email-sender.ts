/**
 * email-sender.ts
 * Abstract email sending behind a provider-agnostic interface.
 * Supports SendGrid, Amazon SES, and Resend, selectable per workspace.
 */

import sgMail from "@sendgrid/mail";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { Resend } from "resend";

export type EmailProvider = "sendgrid" | "ses" | "resend";

export interface SendEmailParams {
  to: string;
  from: string;
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string;
  /** RFC 8058 one-click unsubscribe URL */
  listUnsubscribe?: string;
  /** Custom headers */
  headers?: Record<string, string>;
}

export interface ProviderConfig {
  provider: EmailProvider;
  /** SendGrid API key */
  sendgridApiKey?: string;
  /** SES credentials */
  sesAccessKey?: string;
  sesSecretKey?: string;
  sesRegion?: string;
  /** Resend API key */
  resendApiKey?: string;
}

/**
 * Send a single email using the configured provider.
 * Returns true if the send was accepted.
 */
export async function sendEmail(
  params: SendEmailParams,
  config: ProviderConfig
): Promise<boolean> {
  if (config.provider === "resend" && config.resendApiKey) {
    return sendWithResend(params, config);
  }
  if (config.provider === "ses" && config.sesAccessKey && config.sesSecretKey) {
    return sendWithSes(params, config);
  }
  // Default: SendGrid
  return sendWithSendGrid(params, config);
}

async function sendWithSendGrid(
  params: SendEmailParams,
  config: ProviderConfig
): Promise<boolean> {
  if (!config.sendgridApiKey) {
    throw new Error("SendGrid API key not configured");
  }

  sgMail.setApiKey(config.sendgridApiKey);

  const msg: sgMail.MailDataRequired = {
    to: params.to,
    from: params.from,
    subject: params.subject,
    text: params.text || "",
    html: params.html || undefined,
  };

  if (params.replyTo) msg.replyTo = params.replyTo;

  // RFC 8058 List-Unsubscribe
  if (params.listUnsubscribe) {
    (msg as any).headers = {
      ...(msg as any).headers,
      "List-Unsubscribe": `<${params.listUnsubscribe}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    };
  }

  if (params.headers) {
    (msg as any).headers = { ...(msg as any).headers, ...params.headers };
  }

  await sgMail.send(msg);
  return true;
}

async function sendWithSes(
  params: SendEmailParams,
  config: ProviderConfig
): Promise<boolean> {
  if (!config.sesAccessKey || !config.sesSecretKey) {
    throw new Error("SES credentials not configured");
  }

  const client = new SESClient({
    region: config.sesRegion || "us-east-1",
    credentials: {
      accessKeyId: config.sesAccessKey,
      secretAccessKey: config.sesSecretKey,
    },
  });

  const command = new SendEmailCommand({
    Source: params.from,
    Destination: { ToAddresses: [params.to] },
    Message: {
      Subject: { Data: params.subject, Charset: "UTF-8" },
      Body: {
        ...(params.text ? { Text: { Data: params.text, Charset: "UTF-8" } } : {}),
        ...(params.html ? { Html: { Data: params.html, Charset: "UTF-8" } } : {}),
      },
    },
    ...(params.replyTo ? { ReplyToAddresses: [params.replyTo] } : {}),
  });

  // Add List-Unsubscribe header if provided
  if (params.listUnsubscribe) {
    (command.input as any).HeadersInBrackets = {
      "List-Unsubscribe": `<${params.listUnsubscribe}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    };
  }

  await client.send(command);
  return true;
}

async function sendWithResend(
  params: SendEmailParams,
  config: ProviderConfig
): Promise<boolean> {
  if (!config.resendApiKey) {
    throw new Error("Resend API key not configured");
  }

  const resend = new Resend(config.resendApiKey);

  await resend.emails.send({
    from: params.from,
    to: params.to,
    subject: params.subject,
    text: params.text || "",
    html: params.html || undefined,
    replyTo: params.replyTo,
    headers: params.listUnsubscribe
      ? {
          "List-Unsubscribe": `<${params.listUnsubscribe}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          ...params.headers,
        }
      : params.headers,
  });

  return true;
}

/**
 * Returns a human-readable provider name for display.
 */
export function providerLabel(provider: EmailProvider): string {
  const labels: Record<EmailProvider, string> = {
    sendgrid: "SendGrid",
    ses: "Amazon SES",
    resend: "Resend",
  };
  return labels[provider] || "SendGrid";
}

/**
 * Returns cost estimate per 10,000 emails for the provider.
 */
export function providerCostEstimate(provider: EmailProvider): string {
  const costs: Record<EmailProvider, string> = {
    sendgrid: "Free tier: 100/day, then plan-based",
    ses: "$1.00",
    resend: "Free tier: 3,000/month, then $0.001/email",
  };
  return costs[provider] || "Varies";
}

/**
 * Send a transactional email using the app's built-in SendGrid credentials.
 * Reads SENDGRID_API_KEY and SENDGRID_FROM_EMAIL from environment variables.
 * This is for system emails (welcome, password reset, etc.) sent before a
 * workspace configures their own provider.
 */
export async function sendTransactionalEmail(params: {
  to: string;
  subject: string;
  text?: string;
  html?: string;
}): Promise<boolean> {
  const apiKey = process.env.SENDGRID_API_KEY;
  const fromEmail = process.env.SENDGRID_FROM_EMAIL;
  if (!apiKey || !fromEmail) {
    console.error("sendTransactionalEmail: Missing SENDGRID_API_KEY or SENDGRID_FROM_EMAIL env vars");
    throw new Error("Transactional email provider not configured. Set SENDGRID_API_KEY and SENDGRID_FROM_EMAIL.");
  }
  return sendEmail(
    { to: params.to, from: fromEmail, subject: params.subject, text: params.text, html: params.html },
    { provider: "sendgrid", sendgridApiKey: apiKey }
  );
}
