import { SESClient, SendRawEmailCommand, GetSendQuotaCommand } from "@aws-sdk/client-ses";
import { randomUUID } from "node:crypto";
import type { EmailTransport, SendParams, SendResult, SendError, ProviderHealth } from "./transport";

/**
 * Amazon SES transport.
 *
 * SES's classic `SendEmail` API cannot carry arbitrary headers, but the bulk
 * send path sets `List-Unsubscribe` (RFC 8058 one-click unsubscribe). So every
 * send goes out as a raw MIME message via `SendRawEmailCommand`, which lets us
 * emit those headers exactly like the SendGrid transport does.
 *
 * Credentials are per-workspace (access key / secret / region), resolved by the
 * registry from the `clients` row or the AWS_* environment fallback.
 */

const CRLF = "\r\n";

function b64(s: string): string {
  return Buffer.from(s, "utf8").toString("base64");
}

/** Wrap a base64 blob at 76 chars per line (SMTP line-length safety). */
function wrap76(s: string): string {
  const lines: string[] = [];
  for (let i = 0; i < s.length; i += 76) lines.push(s.slice(i, i + 76));
  return lines.join(CRLF);
}

/** RFC 2047-encode a header value only when it contains non-ASCII. */
function encodeHeaderWord(s: string): string {
  return /[^\x00-\x7F]/.test(s) ? `=?UTF-8?B?${b64(s)}?=` : s;
}

/**
 * Remove anything that could end the current header line.
 *
 * Header values arrive here already rendered: the subject passes through
 * renderTemplate() with the recipient's own profile, so `{{first_name}}` in a
 * subject line puts subscriber-controlled text directly into a MIME header. A
 * value containing CRLF would close `Subject:` and open a new header - enough to
 * add a Bcc, set Reply-To, or start a second body.
 *
 * encodeHeaderWord() is not a defence: it only encodes when a value contains
 * non-ASCII, and CR and LF are both ASCII, so a plain-ASCII injection passed
 * straight through. Strip first, encode second.
 */
function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n\0\u2028\u2029]+/g, " ").trim();
}

/** A header name may only be an RFC 5322 token - no colons, spaces or breaks. */
const VALID_HEADER_NAME = /^[A-Za-z0-9!#$%&'*+\-.^_`|~]+$/;

/** Headers we always control - never let a caller-supplied header duplicate them. */
const RESERVED_HEADERS = /^(from|to|subject|reply-to|mime-version|content-type|content-transfer-encoding|list-unsubscribe|list-unsubscribe-post)$/i;

/**
 * Build a MIME message for SES `SendRawEmail`. Exported for unit testing.
 * `boundary` is injectable so tests can assert against a fixed value.
 */
export function buildRawMessage(params: SendParams, boundary: string = randomUUID()): string {
  const address = sanitizeHeaderValue(params.from);
  const from = params.fromName
    ? `${encodeHeaderWord(sanitizeHeaderValue(params.fromName))} <${address}>`
    : address;

  const headers: string[] = [`From: ${from}`, `To: ${sanitizeHeaderValue(params.to)}`];
  if (params.replyTo) headers.push(`Reply-To: ${sanitizeHeaderValue(params.replyTo)}`);
  headers.push(`Subject: ${encodeHeaderWord(sanitizeHeaderValue(params.subject))}`);
  headers.push("MIME-Version: 1.0");
  if (params.listUnsubscribe) {
    headers.push(`List-Unsubscribe: <${sanitizeHeaderValue(params.listUnsubscribe)}>`);
    headers.push("List-Unsubscribe-Post: List-Unsubscribe=One-Click");
  }
  if (params.headers) {
    for (const [k, v] of Object.entries(params.headers)) {
      if (RESERVED_HEADERS.test(k)) continue;
      // A name carrying a colon or a line break would inject a header of its
      // own, so anything that isn't a bare token is dropped rather than fixed.
      if (!VALID_HEADER_NAME.test(k)) continue;
      headers.push(`${k}: ${sanitizeHeaderValue(String(v))}`);
    }
  }

  const { html, text } = params;

  if (html && text) {
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    const body = [
      `--${boundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      wrap76(b64(text)),
      `--${boundary}`,
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      wrap76(b64(html)),
      `--${boundary}--`,
      "",
    ].join(CRLF);
    return headers.join(CRLF) + CRLF + CRLF + body;
  }

  const single = html
    ? { type: "text/html", content: html }
    : { type: "text/plain", content: text || "" };
  headers.push(`Content-Type: ${single.type}; charset=UTF-8`);
  headers.push("Content-Transfer-Encoding: base64");
  return headers.join(CRLF) + CRLF + CRLF + wrap76(b64(single.content));
}

/**
 * Map an AWS SDK error to the transport's SendError contract. Exported for tests.
 * `retryable` mirrors the dispatcher's fallback semantics: transient → try the
 * next provider; permanent (auth, unverified sender) → stop.
 */
export function mapSesError(err: any): { statusCode?: number; error: SendError } {
  const name: string = err?.name || err?.Code || "";
  const http: number | undefined = err?.$metadata?.httpStatusCode;
  const message: string = err?.message || String(err);

  if (/throttl/i.test(name) || http === 429) {
    return { statusCode: http, error: { code: "RATE_LIMITED", message, retryable: true } };
  }
  if (
    /AccessDenied|InvalidClientTokenId|SignatureDoesNotMatch|UnrecognizedClient|InvalidAccessKeyId|IncompleteSignature|AuthFailure/i.test(name) ||
    http === 401 ||
    http === 403
  ) {
    return { statusCode: http, error: { code: "AUTH_FAILED", message, retryable: false } };
  }
  if (/MessageRejected|NotVerified|MailFromDomain|EmailAddressNotVerified|AccountSendingPaused|ConfigurationSetDoesNotExist/i.test(name)) {
    return { statusCode: http, error: { code: "PROVIDER_ERROR", message, retryable: false } };
  }
  if (http && http >= 500) {
    return { statusCode: http, error: { code: "PROVIDER_ERROR", message, retryable: true } };
  }
  if (!http) {
    return { error: { code: "NETWORK_ERROR", message, retryable: true } };
  }
  return { statusCode: http, error: { code: "PROVIDER_ERROR", message, retryable: false } };
}

export interface SESConfig {
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
}

export class SESTransport implements EmailTransport {
  readonly id = "ses";
  /** SES SendRawEmail is one message per call. */
  readonly maxBatchSize = 1;
  private client: SESClient;

  constructor(private config: SESConfig) {
    this.client = new SESClient({
      region: config.region || "us-east-1",
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async send(params: SendParams): Promise<SendResult> {
    if (!this.config.accessKeyId || !this.config.secretAccessKey) {
      return {
        success: false,
        error: { code: "AUTH_FAILED", message: "AWS SES credentials are not configured.", retryable: false },
      };
    }
    try {
      const raw = buildRawMessage(params);
      const out = await this.client.send(
        new SendRawEmailCommand({
          Source: params.from,
          Destinations: [params.to],
          RawMessage: { Data: Buffer.from(raw, "utf8") },
        }),
      );
      return { success: true, messageId: out.MessageId, statusCode: out.$metadata?.httpStatusCode };
    } catch (err) {
      const mapped = mapSesError(err);
      return { success: false, statusCode: mapped.statusCode, error: mapped.error };
    }
  }

  async health(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      await this.client.send(new GetSendQuotaCommand({}));
      return { healthy: true, lastChecked: Date.now(), latencyMs: Date.now() - start };
    } catch (e: any) {
      return {
        healthy: false,
        lastChecked: Date.now(),
        latencyMs: Date.now() - start,
        lastError: e?.message || "SES unreachable",
      };
    }
  }
}
