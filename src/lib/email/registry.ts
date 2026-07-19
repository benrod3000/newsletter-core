import type { EmailTransport } from "./transport";
import { SendGridTransport } from "./sendgrid";
import { ResendTransport } from "./resend";

/**
 * Creates the appropriate email transport based on workspace provider config.
 * Used by the bulk send queue so it never hardcodes a specific provider.
 */
export function createTransport(provider: string, credentials: {
  sendgridApiKey?: string;
  resendApiKey?: string;
}): EmailTransport {
  if (provider === "resend" && credentials.resendApiKey) {
    return new ResendTransport(credentials.resendApiKey);
  }
  // Default: SendGrid (also handles SES since SES goes through
  // email-sender.ts for single sends; bulk sends always use SendGrid/Resend)
  const key = credentials.sendgridApiKey || process.env.SENDGRID_API_KEY || "";
  return new SendGridTransport(key);
}
