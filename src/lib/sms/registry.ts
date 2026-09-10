/**
 * SmsProviderRegistry - the SMS half of the transport registry pattern.
 *
 * Same shape as `src/lib/email/registry.ts`, kept separate rather than merged
 * because the two resolve different credentials and return different interfaces.
 * A single registry holding both would have to return a union that every caller
 * then narrows, which is the conditional the registry exists to remove.
 *
 * Adding a provider:
 *   registry.register("messagebird", (c) => new MessageBirdTransport(c.apiKey));
 */

import type { SmsTransport, SmsCredentials } from "./transport";

type SmsProviderFactory = (config: SmsCredentials) => SmsTransport | null;

class SmsProviderRegistry {
  private factories = new Map<string, SmsProviderFactory>();

  register(id: string, factory: SmsProviderFactory): void {
    this.factories.set(id, factory);
  }

  /**
   * Build a provider, or null if it is unknown or its credentials are incomplete.
   *
   * Returning null for incomplete credentials rather than a transport that fails
   * per message matters at this scale: the alternative is discovering a missing
   * auth token ten thousand identical failures into a drain.
   */
  resolve(id: string, config: SmsCredentials): SmsTransport | null {
    const factory = this.factories.get(id);
    if (!factory) {
      console.error(`[sms-registry] Unknown provider: "${id}". Available: ${this.list().join(", ")}`);
      return null;
    }
    return factory(config);
  }

  list(): string[] {
    return Array.from(this.factories.keys());
  }

  has(id: string): boolean {
    return this.factories.has(id);
  }
}

export const smsRegistry = new SmsProviderRegistry();

import { TwilioTransport } from "./twilio";
import { SmsSandboxTransport } from "./sandbox";

smsRegistry.register("twilio", (config) => {
  if (!config.twilioAccountSid || !config.twilioAuthToken || !config.twilioPhoneNumber) {
    return null;
  }
  return new TwilioTransport(
    config.twilioAccountSid,
    config.twilioAuthToken,
    config.twilioPhoneNumber
  );
});

smsRegistry.register("sandbox", () => new SmsSandboxTransport());
