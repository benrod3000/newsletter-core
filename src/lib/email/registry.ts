/**
 * ProviderRegistry — dependency injection for email providers.
 *
 * Providers register themselves at import time. The dispatcher
 * asks the registry for a provider by ID. No hardcoded conditionals.
 *
 * Adding a new provider:
 *   import { registry } from "./registry";
 *   registry.register("mailgun", (config) => new MailgunTransport(config.apiKey));
 */

import type { EmailTransport } from "./transport";

type ProviderFactory = (config: Record<string, unknown>) => EmailTransport;

class ProviderRegistry {
  private factories = new Map<string, ProviderFactory>();

  /** Register a provider factory. Call at module import time. */
  register(id: string, factory: ProviderFactory): void {
    this.factories.set(id, factory);
  }

  /** Create a provider instance from its registered factory. Returns null if unrecognized. */
  resolve(id: string, config: Record<string, unknown>): EmailTransport | null {
    const factory = this.factories.get(id);
    if (!factory) {
      console.error(`[registry] Unknown provider: "${id}". Available: ${this.list().join(", ")}`);
      return null;
    }
    return factory(config);
  }

  /** List all registered provider IDs. */
  list(): string[] {
    return Array.from(this.factories.keys());
  }

  /** Check if a provider ID is registered. */
  has(id: string): boolean {
    return this.factories.has(id);
  }
}

/** Singleton registry instance */
export const registry = new ProviderRegistry();

// ── Built-in provider registrations ──
import { SendGridTransport } from "./sendgrid";
import { ResendTransport } from "./resend";

registry.register("sendgrid", (config) =>
  new SendGridTransport((config.apiKey as string) || process.env.SENDGRID_API_KEY || "")
);

registry.register("resend", (config) =>
  new ResendTransport((config.apiKey as string) || process.env.RESEND_API_KEY || "")
);
