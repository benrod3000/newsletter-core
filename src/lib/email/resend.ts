import { Resend } from "resend";
import type { EmailTransport, SendParams, SendResult, ProviderHealth } from "./transport";

const RETRYABLE_CODES = new Set(["rate_limit_exceeded", "internal_server_error"]);

export class ResendTransport implements EmailTransport {
  readonly id = "resend";
  readonly maxBatchSize = 100;
  private client: Resend;

  constructor(private apiKey: string) {
    this.client = new Resend(apiKey);
  }

  async send(params: SendParams): Promise<SendResult> {
    try {
      const result = await this.client.emails.send({
        from: params.fromName ? `${params.fromName} <${params.from}>` : params.from,
        to: params.to,
        subject: params.subject,
        html: params.html || undefined,
        text: params.text,
        replyTo: params.replyTo,
      });

      if (result.error) {
        return {
          success: false,
          statusCode: result.error.statusCode || 0,
          error: {
            code: RETRYABLE_CODES.has(result.error.name) ? "RATE_LIMITED" : "PROVIDER_ERROR",
            message: result.error.message,
            retryable: RETRYABLE_CODES.has(result.error.name),
          },
        };
      }

      return { success: true, messageId: result.data?.id || undefined };
    } catch (err: any) {
      return {
        success: false,
        error: { code: "NETWORK_ERROR", message: err?.message || "Connection failed", retryable: true },
      };
    }
  }

  async health(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      const res = await fetch("https://api.resend.com/emails?limit=1", {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      return {
        healthy: res.ok,
        lastChecked: Date.now(),
        latencyMs: Date.now() - start,
        lastError: res.ok ? undefined : `HTTP ${res.status}`,
      };
    } catch (e: any) {
      return {
        healthy: false,
        lastChecked: Date.now(),
        latencyMs: Date.now() - start,
        lastError: e?.message || "Connection failed",
      };
    }
  }
}
