import { Resend } from "resend";
import type { EmailTransport, SendParams } from "./transport";

export class ResendTransport implements EmailTransport {
  readonly id = "resend";
  private client: Resend;

  constructor(private apiKey: string) {
    this.client = new Resend(apiKey);
  }

  async send(params: SendParams): Promise<boolean> {
    await this.client.emails.send({
      from: params.fromName ? `${params.fromName} <${params.from}>` : params.from,
      to: params.to,
      subject: params.subject,
      html: params.html || undefined,
      text: params.text,
      replyTo: params.replyTo,
    });
    return true;
  }

  async verify(): Promise<{ valid: boolean; message: string }> {
    try {
      const res = await fetch("https://api.resend.com/audiences", {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      if (res.ok) return { valid: true, message: "Resend key is valid." };
      return { valid: false, message: `Resend key rejected: ${res.status}` };
    } catch (e: any) {
      return { valid: false, message: e?.message || "Could not verify Resend key" };
    }
  }

  supportsBatch() { return false; }
}
