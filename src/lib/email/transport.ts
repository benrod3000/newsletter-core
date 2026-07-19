/**
 * Email Transport abstraction.
 *
 * Every email provider implements this interface, so the send queue
 * never touches SendGrid/SES/Resend directly. Add a new provider
 * by implementing these methods and registering it in ProviderRegistry.
 */

export interface EmailTransport {
  /** Provider identifier (sendgrid, ses, resend, etc.) */
  readonly id: string;

  /** Send a single email. Returns true if accepted. */
  send(params: SendParams): Promise<boolean>;

  /** Verify the credentials work. Returns { valid, message }. */
  verify(): Promise<{ valid: boolean; message: string }>;

  /** Whether this transport supports batch/bulk sending natively */
  supportsBatch(): boolean;
}

export interface SendParams {
  to: string;
  from: string;
  fromName?: string;
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
  headers?: Record<string, string>;
  /** RFC 8058 one-click unsubscribe */
  listUnsubscribe?: string;
  /** Optional provider-specific metadata */
  metadata?: Record<string, string>;
}

export interface ProviderCredentials {
  sendgridApiKey?: string;
  sesAccessKey?: string;
  sesSecretKey?: string;
  sesRegion?: string;
  resendApiKey?: string;
}
