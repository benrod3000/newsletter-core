import type { SmsTransport, SmsSendParams } from "./transport";
import type { SendResult, ProviderHealth } from "../messaging/result";

/**
 * Twilio Programmable Messaging.
 *
 * The API call itself already existed, inline in the SMS campaign route. What it
 * did not have, and what this class exists for, is a real answer to "should this
 * be retried".
 *
 * The old loop caught every failure into `failed++` and moved on. So a rate
 * limit, which clears in a second, and an invalid number, which never clears,
 * were treated identically: both dropped, neither retried, nothing recorded. The
 * send queue's `sendWithRetry` already honours `retryable` and already backs off,
 * so classifying correctly here is the entire value of moving SMS onto it.
 *
 * Getting the classification wrong is expensive in both directions. A permanent
 * error marked retryable burns three attempts per recipient against a provider
 * that is rate limiting you, which makes the rate limiting worse. A transient
 * error marked permanent silently drops a real person from a campaign they
 * consented to.
 */

const TWILIO_API = "https://api.twilio.com/2010-04-01";

/**
 * Twilio error codes that mean "do not try this recipient again".
 *
 * https://www.twilio.com/docs/api/errors
 */
const PERMANENT_CODES = new Map<number, string>([
  [21211, "INVALID_ADDRESS"], // 'To' is not a valid phone number
  [21214, "INVALID_ADDRESS"], // 'To' is not a mobile number
  [21614, "INVALID_ADDRESS"], // 'To' is not SMS capable
  [21408, "REGION_NOT_ENABLED"], // account not permitted to message this region
  [21610, "RECIPIENT_OPTED_OUT"], // recipient replied STOP to this sender
]);

/**
 * Codes that mean the workspace's configuration is wrong, not the recipient.
 *
 * Separated because the response is different: retrying is pointless, but so is
 * marking the recipient bad. The whole job is misconfigured and every recipient
 * will fail the same way, so this should stop the drain rather than grind
 * through the audience recording ten thousand identical failures.
 */
const CONFIG_CODES = new Map<number, string>([
  [20003, "AUTH_FAILED"], // authentication failed
  [21606, "INVALID_SENDER"], // 'From' is not a valid, SMS-capable Twilio number
  [21612, "INVALID_SENDER"], // 'From' cannot reach this 'To'
  [21659, "INVALID_SENDER"], // 'From' is not a valid, verified sender
]);

export class TwilioTransport implements SmsTransport {
  readonly id = "twilio";

  /**
   * One message per second, the long-code ceiling.
   *
   * Conservative on purpose. A toll-free or short code is faster and a Messaging
   * Service with a number pool faster still, but assuming the fast case and
   * being wrong means messages queue at Twilio for hours while the job here
   * reports a completed send. Assuming the slow case and being wrong only means
   * a drain finishes sooner than the estimate.
   */
  readonly messagesPerSecond = 1;

  constructor(
    private accountSid: string,
    private authToken: string,
    private fromNumber: string
  ) {}

  private get authHeader(): string {
    return `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString("base64")}`;
  }

  async send(params: SmsSendParams): Promise<SendResult> {
    const form = new URLSearchParams({
      To: params.to,
      From: params.from || this.fromNumber,
      Body: params.body,
    });
    for (const url of params.mediaUrls ?? []) form.append("MediaUrl", url);

    let res: Response;
    try {
      res = await fetch(`${TWILIO_API}/Accounts/${this.accountSid}/Messages.json`, {
        method: "POST",
        headers: {
          Authorization: this.authHeader,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form,
        signal: AbortSignal.timeout(15000),
      });
    } catch (err: unknown) {
      // Includes the timeout above. A message that timed out may still have been
      // accepted, so this is retryable and the queue's attempt limit is what
      // bounds the duplicate risk.
      return {
        success: false,
        error: {
          code: "NETWORK_ERROR",
          message: err instanceof Error ? err.message : "Connection failed",
          retryable: true,
        },
      };
    }

    if (res.ok) {
      const data = (await res.json().catch(() => null)) as { sid?: string } | null;
      return { success: true, messageId: data?.sid, statusCode: res.status };
    }

    const body = (await res.json().catch(() => null)) as
      | { code?: number; message?: string }
      | null;
    const code = typeof body?.code === "number" ? body.code : undefined;
    const message = body?.message ?? `Twilio returned HTTP ${res.status}`;

    if (code !== undefined && PERMANENT_CODES.has(code)) {
      return {
        success: false,
        statusCode: res.status,
        error: { code: PERMANENT_CODES.get(code)!, message, retryable: false },
      };
    }

    if (code !== undefined && CONFIG_CODES.has(code)) {
      return {
        success: false,
        statusCode: res.status,
        error: { code: CONFIG_CODES.get(code)!, message, retryable: false },
      };
    }

    // 429 is the documented rate limit. Twilio also uses 20429 in the body for
    // the same thing, and either can arrive.
    if (res.status === 429 || code === 20429) {
      return {
        success: false,
        statusCode: res.status,
        error: { code: "RATE_LIMITED", message, retryable: true },
      };
    }

    if (res.status >= 500) {
      return {
        success: false,
        statusCode: res.status,
        error: { code: "PROVIDER_ERROR", message, retryable: true },
      };
    }

    // An unrecognized 4xx. Not retryable: Twilio 4xx means it rejected the
    // request, and repeating an identical request gets an identical rejection.
    // Defaulting the other way would turn one bad recipient into three API calls
    // and three log lines with nothing to show for it.
    return {
      success: false,
      statusCode: res.status,
      error: { code: "PROVIDER_ERROR", message, retryable: false },
    };
  }

  /**
   * Credentials work, and the sender number can actually send SMS.
   *
   * Both halves matter. Checking the credentials alone is the false green that
   * caught this project out three times with Resend: a valid key, then a valid
   * sender address, then a verified domain, each of which looked like proof and
   * was not. A Twilio account can authenticate perfectly and hold a number with
   * no SMS capability, and the send fails per message with 21606.
   */
  async health(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      const res = await fetch(
        `${TWILIO_API}/Accounts/${this.accountSid}/IncomingPhoneNumbers.json` +
          `?PhoneNumber=${encodeURIComponent(this.fromNumber)}`,
        { headers: { Authorization: this.authHeader }, signal: AbortSignal.timeout(10000) }
      );

      if (!res.ok) {
        return {
          healthy: false,
          lastChecked: Date.now(),
          latencyMs: Date.now() - start,
          lastError:
            res.status === 401
              ? "Twilio rejected the account SID or auth token"
              : `Twilio returned HTTP ${res.status}`,
        };
      }

      const data = (await res.json()) as {
        incoming_phone_numbers?: { capabilities?: { sms?: boolean } }[];
      };
      const number = data.incoming_phone_numbers?.[0];

      if (!number) {
        return {
          healthy: false,
          lastChecked: Date.now(),
          latencyMs: Date.now() - start,
          lastError: `${this.fromNumber} is not a number on this Twilio account`,
        };
      }

      if (!number.capabilities?.sms) {
        return {
          healthy: false,
          lastChecked: Date.now(),
          latencyMs: Date.now() - start,
          lastError: `${this.fromNumber} cannot send SMS`,
        };
      }

      return { healthy: true, lastChecked: Date.now(), latencyMs: Date.now() - start };
    } catch (err: unknown) {
      return {
        healthy: false,
        lastChecked: Date.now(),
        latencyMs: Date.now() - start,
        lastError: err instanceof Error ? err.message : "Connection failed",
      };
    }
  }
}

/**
 * Exported for the send path, which has to act on this specific outcome rather
 * than just recording it.
 *
 * Twilio keeps its own opt-out list per sender. If someone replied STOP directly
 * to the number, Twilio refuses the message with 21610 whatever this database
 * believes. Leaving `sms_consent` true after that means every future campaign
 * re-attempts them, re-fails, and quietly logs a failure for a person who has
 * already said no twice.
 */
export const OPTED_OUT_ERROR_CODE = "RECIPIENT_OPTED_OUT";
