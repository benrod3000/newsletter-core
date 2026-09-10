/**
 * Email Transport abstraction.
 *
 * Every email provider implements this interface. The send queue
 * never knows which provider is handling the email.
 *
 * Adding a new provider means:
 * 1. Implement EmailTransport
 * 2. Register it in ProviderRegistry
 * 3. Done. No other code changes needed.
 */

import type { SendResult, ProviderHealth } from "../messaging/result";

export interface EmailTransport {
  /** Provider identifier (sendgrid, resend, ses, postmark, mailgun, etc.) */
  readonly id: string;

  /** Maximum emails per single API call. Used for batching. */
  readonly maxBatchSize: number;

  /** Send a single email. Never throws - always returns a SendResult. */
  send(params: SendParams): Promise<SendResult>;

  /** Check if provider is reachable and credentials are valid. */
  health(): Promise<ProviderHealth>;
}

// ── Types ──

export interface SendParams {
  to: string;
  from: string;
  fromName?: string;
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
  headers?: Record<string, string>;
  /** RFC 8058 one-click unsubscribe URL */
  listUnsubscribe?: string;
  /** For sandbox mode: campaign and subscriber context for synthetic event generation */
  campaignId?: string;
  subscriberId?: string;
  /**
   * Owning workspace. Only the sandbox transport reads it, to stamp the
   * synthetic campaign_events it writes - that column is NOT NULL as of
   * migration 048. Real transports hand off to a provider and never write rows.
   */
  workspaceId?: string;
}

/**
 * Moved to `src/lib/messaging/result.ts` and re-exported here.
 *
 * Nothing in them was email-specific; they describe whether a provider accepted a
 * message and whether a retry is worth making, which is identical for SMS. The
 * SMS transport implements the same contract, so `sendWithRetry` in the send
 * queue works for both without knowing which channel it is driving.
 *
 * Re-exported rather than relocated outright so no email import had to change.
 */
export type { SendResult, SendError, ProviderHealth } from "../messaging/result";

export interface ProviderCredentials {
  sendgridApiKey?: string;
  sesAccessKey?: string;
  sesSecretKey?: string;
  sesRegion?: string;
  resendApiKey?: string;
}
