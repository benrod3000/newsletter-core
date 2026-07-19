import sgMail from "@sendgrid/mail";
import type { EmailTransport, SendParams } from "./transport";

export class SendGridTransport implements EmailTransport {
  readonly id = "sendgrid";

  constructor(private apiKey: string) {
    sgMail.setApiKey(apiKey);
  }

  async send(params: SendParams): Promise<boolean> {
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

    await sgMail.send(msg);
    return true;
  }

  async verify(): Promise<{ valid: boolean; message: string }> {
    try {
      const res = await fetch("https://api.sendgrid.com/v3/api_keys", {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      if (res.ok) {
        const data = await res.json();
        const keyId = this.apiKey.split(".")[1];
        const matched = data.api_keys?.find((k: any) => k.api_key_id === keyId);
        return { valid: true, message: matched ? `SendGrid key "${matched.name}" is active.` : "SendGrid key is valid." };
      }
      return { valid: false, message: `SendGrid key rejected: ${res.status}` };
    } catch (e: any) {
      return { valid: false, message: e?.message || "Could not verify SendGrid key" };
    }
  }

  supportsBatch() { return true; }
}
