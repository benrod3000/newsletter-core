/**
 * Single entry point for all SMS sending.
 *
 * Mirrors `email/dispatcher.ts`, minus the fallback chain. Email can fall back
 * from one provider to another because the destination is the same address
 * either way. SMS cannot: the sender number is part of the recipient's
 * relationship with the brand, carriers filter on it, and STOP is recorded
 * against it. Silently re-sending from a different number would text someone
 * from a number they never agreed to hear from, and their previous STOP would
 * not apply to it.
 *
 * So there is one provider per workspace, and a failure is a failure.
 */

import type { SmsSendParams, SmsCredentials } from "./transport";
import type { SendResult } from "../messaging/result";
import { smsRegistry } from "./registry";
import { bus } from "@/lib/events";

export interface SmsDispatchResult extends SendResult {
  provider: string;
}

export interface SmsDispatchConfig {
  /** Provider id, currently "twilio". */
  provider: string;
  credentials: SmsCredentials;
  /** Route everything to the sandbox transport instead of a real carrier. */
  sandbox?: boolean;
}

export async function dispatchSms(
  params: SmsSendParams,
  config: SmsDispatchConfig
): Promise<SmsDispatchResult> {
  if (config.sandbox) {
    const sandbox = smsRegistry.resolve("sandbox", {});
    if (!sandbox) {
      return {
        success: false,
        provider: "sandbox",
        error: { code: "PROVIDER_ERROR", message: "Sandbox transport missing", retryable: false },
      };
    }
    const result = await sandbox.send(params);
    return { ...result, provider: "sandbox" };
  }

  const transport = smsRegistry.resolve(config.provider, config.credentials);

  if (!transport) {
    // Not retryable, and deliberately specific. The registry returns null for
    // incomplete credentials as well as an unknown provider, and both mean every
    // recipient in this job will fail identically. Retrying ten thousand times
    // to discover the same missing auth token helps nobody.
    return {
      success: false,
      provider: config.provider,
      error: {
        code: "AUTH_FAILED",
        message: `SMS provider "${config.provider}" is not configured for this workspace`,
        retryable: false,
      },
    };
  }

  const result = await transport.send(params);

  bus.emit({
    type: result.success ? "message:sent" : "message:failed",
    timestamp: Date.now(),
    campaignId: params.campaignId ?? "",
    workspaceId: params.workspaceId ?? "",
    // Channel is a property of the event, never part of its name. `message.sent`
    // with channel: 'sms', not `sms.sent` - the agreed architecture direction,
    // because channel-in-the-name forces every consumer to enumerate channels.
    data: { channel: "sms", provider: transport.id },
  });

  return { ...result, provider: transport.id };
}

/**
 * How fast this configuration can send, for the drain to pace itself by.
 *
 * Returns the transport's own ceiling rather than a constant, because it is an
 * external limit and not a tuning knob: a Twilio long code is one message per
 * second and exceeding it does not fail loudly, it queues at the provider for
 * hours while the job here believes it finished.
 */
export function smsMessagesPerSecond(config: SmsDispatchConfig): number {
  const transport = config.sandbox
    ? smsRegistry.resolve("sandbox", {})
    : smsRegistry.resolve(config.provider, config.credentials);
  return transport?.messagesPerSecond ?? 1;
}
