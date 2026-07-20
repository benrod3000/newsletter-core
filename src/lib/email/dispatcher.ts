/**
 * EmailDispatcher — single entry point for all email sending.
 *
 * Does NOT know about specific providers. Asks the registry.
 * Tries primary provider, falls back on transient failure.
 * Emits events so other systems can react.
 */

import type { EmailTransport, SendParams, SendResult } from "./transport";
import { registry } from "./registry";
import { bus } from "@/lib/events";

export interface DispatchResult extends SendResult {
  /** Which provider ultimately handled (or failed) the send */
  provider: string;
  /** True if fallback was used */
  fallbackUsed: boolean;
}

export interface DispatchConfig {
  /** Primary provider ID (e.g. "sendgrid", "resend") */
  provider: string;
  /** Optional fallback provider ID */
  fallbackProvider?: string;
  /** Per-workspace credentials (matches client table columns) */
  credentials: Record<string, unknown>;
  /** Enable sandbox mode — intercepts all sends, generates synthetic events */
  sandbox?: boolean;
}

/**
 * Send an email via the configured provider chain.
 * Tries primary first, then fallback on transient failure.
 * Returns rich result with provider attribution.
 */
export async function dispatchEmail(
  params: SendParams,
  config: DispatchConfig
): Promise<DispatchResult> {
  // Sandbox mode — intercept and simulate
  if (config.sandbox) {
    const sandbox = registry.resolve("sandbox", {});
    if (sandbox) {
      const result = await sandbox.send(params);
      return { ...result, provider: "sandbox", fallbackUsed: false };
    }
  }
  const tried: string[] = [];
  const chain = [config.provider];
  if (config.fallbackProvider && config.fallbackProvider !== config.provider) {
    chain.push(config.fallbackProvider);
  }

  let lastResult: DispatchResult | null = null;

  for (const providerId of chain) {
    tried.push(providerId);

    const transport = registry.resolve(providerId, config.credentials);
    if (!transport) continue;

    const start = Date.now();
    const result = await transport.send(params);
    const latency = Date.now() - start;

    if (result.success) {
      bus.emit({
        type: "email:sent",
        timestamp: Date.now(),
        data: { provider: providerId, latency, messageId: result.messageId },
      });
      return { ...result, provider: providerId, fallbackUsed: tried.length > 1 };
    }

    // Permanent failure — don't try another provider
    if (result.error && !result.error.retryable) {
      bus.emit({
        type: "email:failed",
        timestamp: Date.now(),
        data: { provider: providerId, error: result.error, permanent: true },
      });
      return { ...result, provider: providerId, fallbackUsed: false };
    }

    // Transient failure — log and try next provider
    lastResult = { ...result, provider: providerId, fallbackUsed: tried.length > 1 };

    bus.emit({
      type: "email:failed",
      timestamp: Date.now(),
      data: { provider: providerId, error: result.error, permanent: false, willRetry: tried.length < chain.length },
    });
  }

  // All providers exhausted
  return lastResult || {
    success: false,
    provider: "none",
    fallbackUsed: false,
    error: { code: "ALL_PROVIDERS_FAILED", message: `All ${tried.length} provider(s) failed`, retryable: true },
  };
}

/**
 * Build a DispatchConfig from a workspace client row.
 * Used by admin/send, test-provider, and anywhere that needs
 * provider config from the clients table.
 */
export function buildDispatcherConfig(client: {
  email_provider?: string | null;
  fallback_provider?: string | null;
  sendgrid_api_key?: string | null;
  resend_api_key?: string | null;
} | null | undefined): DispatchConfig {
  return {
    provider: client?.email_provider || "sendgrid",
    fallbackProvider: client?.fallback_provider || undefined,
    credentials: {
      sendgrid: client?.sendgrid_api_key || process.env.SENDGRID_API_KEY,
      resend: client?.resend_api_key || process.env.RESEND_API_KEY,
    },
  };
}
