import sgMail from "@sendgrid/mail";
import type { EmailTransport, SendParams, SendResult, ProviderHealth } from "./transport";

const RETRYABLE_CODES = new Set([429, 500, 502, 503, 504]);

export class SendGridTransport implements EmailTransport {
  readonly id = "sendgrid";
  readonly maxBatchSize = 1000;

  constructor(private apiKey: string) {}

  async send(params: SendParams): Promise<SendResult> {
    const msg: sgMail.MailDataRequired = {
      to: params.to,
      from: params.fromName ? `${params.fromName} <${params.from}>` : params.from,
      subject: params.subject,
      text: params.text || "",
      html: params.html || undefined,
    };

    if (params.replyTo) msg.replyTo = params.replyTo;

    if (params.listUnsubscribe) {
      (msg as any).headers = {
        "List-Unsubscribe": `<${params.listUnsubscribe}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        ...params.headers,
      };
    } else if (params.headers) {
      (msg as any).headers = params.headers;
    }

    try {
      sgMail.setApiKey(this.apiKey);
      const [response] = await sgMail.send(msg);
      return {
        success: true,
        statusCode: response?.statusCode || 202,
        messageId: response?.headers?.["x-message-id"] || undefined,
      };
    } catch (err: any) {
      const code = err?.code || err?.statusCode || 0;
      const message = err?.message || String(err);

      if (code === 401 || code === 403) {
        return { success: false, statusCode: code, error: { code: "AUTH_FAILED", message, retryable: false } };
      }
      if (RETRYABLE_CODES.has(code)) {
        return { success: false, statusCode: code, error: { code: "RATE_LIMITED", message, retryable: true } };
      }
      if (!code) {
        return { success: false, error: { code: "NETWORK_ERROR", message, retryable: true } };
      }
      return { success: false, statusCode: code, error: { code: "PROVIDER_ERROR", message, retryable: false } };
    }
  }

  async health(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      const res = await fetch("https://api.sendgrid.com/v3/mail_settings", {
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
