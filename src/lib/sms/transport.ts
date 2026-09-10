/**
 * SMS Transport abstraction.
 *
 * Deliberately the same shape as `EmailTransport`, sharing `SendResult`,
 * `SendError` and `ProviderHealth` from `src/lib/messaging/result.ts`. That is
 * what lets `sendWithRetry` in the send queue drive either channel without
 * knowing which it is holding, and it is why SMS gets the durable queue rather
 * than a second hand-rolled loop.
 *
 * Adding a provider means implementing this and registering it in
 * `src/lib/sms/registry.ts`. Nothing else changes.
 */

import type { SendResult, ProviderHealth } from "../messaging/result";

export type { SendResult, SendError, ProviderHealth } from "../messaging/result";

export interface SmsTransport {
  /** Provider identifier (twilio, sandbox, ...) */
  readonly id: string;

  /**
   * Messages per second this provider will accept for one sender.
   *
   * Unlike email, this is a hard external ceiling rather than a tuning knob. A
   * Twilio long code is 1 per second, and exceeding it does not fail loudly - it
   * queues at the provider and can take hours to drain while the job here
   * believes it finished. The send queue reads this to size its concurrency, so
   * a provider that lies here will produce a job that reports success long
   * before anyone receives anything.
   */
  readonly messagesPerSecond: number;

  /** Send a single message. Never throws - always returns a SendResult. */
  send(params: SmsSendParams): Promise<SendResult>;

  /** Check that credentials work and the sender is usable. */
  health(): Promise<ProviderHealth>;
}

export interface SmsSendParams {
  /** Recipient, E.164 only. Normalized by `toE164` before it reaches here. */
  to: string;
  /** Sender number or alphanumeric sender id, as the provider expects it. */
  from: string;
  /** The message body, already merged and with the opt-out notice appended. */
  body: string;
  /**
   * Media to attach, turning this into an MMS.
   *
   * Note this is MMS, not RCS. The previous code called it RCS in the UI and in
   * its own comments while doing exactly this, which set an expectation the
   * product could not meet: real RCS needs a Google RBM agent, brand
   * verification and carrier approval, and a different Twilio API entirely.
   */
  mediaUrls?: string[];
  /** Campaign context, used by the sandbox transport to record events. */
  campaignId?: string;
  subscriberId?: string;
  workspaceId?: string;
}

/**
 * Credentials for a workspace's SMS provider.
 *
 * Per workspace, never platform-wide. Sending everyone's SMS from one Twilio
 * account pools sender reputation and carrier filtering across unrelated
 * tenants, which is the same mistake per-workspace email keys fixed in
 * migration 055.
 */
export interface SmsCredentials {
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  twilioPhoneNumber?: string;
}
