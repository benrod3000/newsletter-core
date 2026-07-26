/**
 * ProviderRegistry - dependency injection for email providers.
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
import { SESTransport } from "./ses";
import { SandboxTransport } from "./sandbox";

registry.register("sendgrid", (config) =>
  new SendGridTransport(
    (config.sendgrid as string) || (config.apiKey as string) || process.env.SENDGRID_API_KEY || ""
  )
);

registry.register("resend", (config) =>
  new ResendTransport(
    (config.resend as string) || (config.apiKey as string) || process.env.RESEND_API_KEY || ""
  )
);

registry.register("ses", (config) =>
  new SESTransport({
    accessKeyId: (config.sesAccessKey as string) || (config.ses_access_key as string) || process.env.AWS_ACCESS_KEY_ID || "",
    secretAccessKey: (config.sesSecretKey as string) || (config.ses_secret_key as string) || process.env.AWS_SECRET_ACCESS_KEY || "",
    region: (config.sesRegion as string) || (config.ses_region as string) || process.env.AWS_SES_REGION || process.env.AWS_REGION || "us-east-1",
  })
);

registry.register("sandbox", (config) =>
  new SandboxTransport({
    openRate: config.openRate as number | undefined,
    clickRate: config.clickRate as number | undefined,
  })
);
