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

export interface SendResult {
  success: boolean;
  /** Provider-assigned message ID for webhook reconciliation */
  messageId?: string;
  /** HTTP status code from the provider's API */
  statusCode?: number;
  /** Only present when success is false */
  error?: SendError;
}

export interface SendError {
  /** Machine-readable: RATE_LIMITED, INVALID_ADDRESS, AUTH_FAILED, NETWORK_ERROR, PROVIDER_ERROR */
  code: string;
  /** Human-readable description for logging */
  message: string;
  /** If true, the caller may retry (transient). If false, retry won't help (permanent). */
  retryable: boolean;
}

export interface ProviderHealth {
  healthy: boolean;
  /** Unix timestamp of last health check */
  lastChecked: number;
  /** Error message from the last failed check, if any */
  lastError?: string;
  /** Response time in milliseconds */
  latencyMs?: number;
}

export interface ProviderCredentials {
  sendgridApiKey?: string;
  sesAccessKey?: string;
  sesSecretKey?: string;
  sesRegion?: string;
  resendApiKey?: string;
}
