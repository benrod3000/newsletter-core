/**
 * What a send attempt returns, for any channel.
 *
 * These three types started life inside `email/transport.ts` and were email
 * types only by accident of where they were written. Nothing in them mentions an
 * address or a subject: they describe "did the provider take it, can I retry, and
 * is the provider healthy", which is the same question for email, SMS and
 * whatever comes third.
 *
 * They live here so the SMS transport can implement the same contract without
 * importing from an email module, and so `sendWithRetry` in `send-queue.ts` can
 * keep working for both without knowing which it is holding.
 *
 * `email/transport.ts` re-exports them, so no email code changed.
 */

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
  /**
   * If true, the caller may retry (transient). If false, retry will not help.
   *
   * This is the field the send queue actually acts on, and getting it wrong is
   * expensive in both directions: a permanent error marked retryable burns three
   * attempts per recipient against a provider rate limit, and a transient error
   * marked permanent drops a real recipient on the floor.
   */
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
