import crypto from "crypto";

/**
 * Verify that a request really came from Twilio.
 *
 * The inbound SMS webhook had no verification at all. It is a public endpoint
 * that reads a phone number out of the request body and opts that person out, so
 * anyone who knew the URL could opt out anyone whose number they could guess -
 * and a phone number is not a secret. It could also be used the other way, as an
 * unauthenticated way to probe which numbers exist in the database by watching
 * for a behavioural difference.
 *
 * Twilio's scheme: take the full request URL, append every POST parameter as
 * key then value concatenated in lexicographic key order, HMAC-SHA1 that with
 * the account's auth token, and base64 the result. That is the value in
 * `X-Twilio-Signature`.
 *
 * https://www.twilio.com/docs/usage/security#validating-requests
 */

/**
 * The URL Twilio signed, which is not always the URL this process sees.
 *
 * Twilio signs the URL it was configured with. Behind a proxy, `req.url` can
 * report http where the request arrived as https, and a one-character
 * difference changes the whole digest. So the proto and host come from the
 * forwarded headers, the same reasoning as `getApiBaseUrl` in geo-utils.
 */
export function signedUrlFor(req: Request): string {
  const url = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (proto) url.protocol = `${proto.split(",")[0].trim()}:`;
  if (host) url.host = host.split(",")[0].trim();
  return url.toString();
}

export function computeTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>
): string {
  const payload = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);

  return crypto.createHmac("sha1", authToken).update(Buffer.from(payload, "utf-8")).digest("base64");
}

/**
 * Constant-time comparison of the expected and provided signatures.
 *
 * `===` on a digest leaks how many leading bytes matched through timing, which
 * over enough requests is enough to forge one. `timingSafeEqual` throws on a
 * length mismatch, so the lengths are checked first and a mismatch is simply a
 * failure rather than an exception.
 */
export function verifyTwilioSignature(params: {
  authToken: string;
  url: string;
  body: Record<string, string>;
  signature: string | null;
}): boolean {
  const { authToken, url, body, signature } = params;
  if (!authToken || !signature) return false;

  const expected = computeTwilioSignature(authToken, url, body);
  const a = Buffer.from(expected, "utf-8");
  const b = Buffer.from(signature, "utf-8");
  if (a.length !== b.length) return false;

  return crypto.timingSafeEqual(a, b);
}
