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

    // Echoed back on the event webhook. Without them a bounce or complaint
    // arrives carrying only an address, which is ambiguous — the same address
    // can be a subscriber in several workspaces — and suppression cannot be
    // attributed to one tenant. See app/api/webhooks/sendgrid/route.ts.
    const customArgs: Record<string, string> = {};
    if (params.campaignId) customArgs.campaign_id = params.campaignId;
    if (params.subscriberId) customArgs.subscriber_id = params.subscriberId;
    if (Object.keys(customArgs).length > 0) msg.customArgs = customArgs;

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
