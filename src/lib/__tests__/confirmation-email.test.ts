import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * The double opt-in confirmation email.
 *
 * This was hardcoded to SendGrid and read SENDGRID_API_KEY / SENDGRID_FROM_EMAIL,
 * neither of which has ever existed in this project's Vercel environment, so no
 * confirmation email has ever been sent by either caller. It was the second copy
 * of the bug already fixed in `sendTransactionalEmail`.
 *
 * The tests that matter here are the ones nothing else in the toolchain can
 * catch: that an unconfigured platform reports a reason instead of claiming
 * success, that the lead magnet travels on the confirm link rather than in the
 * email body, and that a caller-supplied title cannot inject markup.
 */

const sendEmail = vi.fn();

vi.mock("../email-sender", async () => {
  const actual = await vi.importActual<typeof import("../email-sender")>("../email-sender");
  return { ...actual, sendEmail: (...args: unknown[]) => sendEmail(...args) };
});

import { sendConfirmationEmail, EMPTY_SIGNUP_SNAPSHOT } from "../email/confirmation-email";

const saved = { ...process.env };

function configure() {
  process.env.RESEND_API_KEY = "re_test";
  process.env.TRANSACTIONAL_FROM_EMAIL = "noreply@brod3000.com";
}

const base = {
  email: "someone@example.com",
  confirmationToken: "11111111-1111-1111-1111-111111111111",
  unsubscribeToken: "22222222-2222-2222-2222-222222222222",
  host: "newsletter-core.vercel.app",
  leadTitle: null,
  leadUrl: null,
  snapshot: EMPTY_SIGNUP_SNAPSHOT,
};

beforeEach(() => {
  sendEmail.mockReset();
  sendEmail.mockResolvedValue(true);
  delete process.env.RESEND_API_KEY;
  delete process.env.SENDGRID_API_KEY;
  delete process.env.TRANSACTIONAL_FROM_EMAIL;
  delete process.env.SENDGRID_FROM_EMAIL;
  process.env.APP_URL = "https://newsletter-core.vercel.app";
});

afterEach(() => {
  process.env = { ...saved };
});

describe("sendConfirmationEmail", () => {
  it("reports a reason instead of sending when the platform is unconfigured", async () => {
    // The state this shipped in. It must not resolve as sent, because the caller
    // decides whether to tell the visitor their email is on its way.
    const result = await sendConfirmationEmail(base);
    expect(result.sent).toBe(false);
    if (!result.sent) expect(result.reason).toMatch(/not configured/i);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("sends once configured, with an unsubscribe header", async () => {
    configure();
    const result = await sendConfirmationEmail(base);
    expect(result.sent).toBe(true);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const [params, config] = sendEmail.mock.calls[0];
    expect(config.provider).toBe("resend");
    expect(params.to).toBe("someone@example.com");
    expect(params.listUnsubscribe).toContain(base.unsubscribeToken);
  });

  it("puts the lead magnet on the confirm link, not as a clickable link of its own", async () => {
    // The address has to be confirmed before the file is handed over, so the
    // only way to the file is through /api/confirm. It rides along as an encoded
    // query parameter; what must not exist is a direct href to it.
    configure();
    await sendConfirmationEmail({
      ...base,
      leadTitle: "My Resume",
      leadUrl: "https://example.com/secret.pdf",
    });
    const [params] = sendEmail.mock.calls[0];
    expect(params.html).not.toContain('href="https://example.com/secret.pdf"');
    expect(params.text).not.toContain(" https://example.com/secret.pdf");
    expect(params.html).toContain("lead_url=https%3A%2F%2Fexample.com%2Fsecret.pdf");
    expect(params.html).toContain("/api/confirm?token=");
  });

  it("escapes a caller-supplied lead title", async () => {
    // `lead_title` arrives in the /api/subscribe request body, so an unescaped
    // value let a caller inject markup into mail sent to any address.
    configure();
    await sendConfirmationEmail({
      ...base,
      leadTitle: '<img src=x onerror="alert(1)">',
      leadUrl: "https://example.com/f.pdf",
    });
    const [params] = sendEmail.mock.calls[0];
    expect(params.html).not.toContain("<img src=x");
    expect(params.html).toContain("&lt;img src=x");
  });

  it("names the audience it was given rather than a hardcoded newsletter", async () => {
    configure();
    await sendConfirmationEmail({ ...base, audienceName: "Ben's Workspace" });
    const [params] = sendEmail.mock.calls[0];
    expect(params.html).toContain("Ben&#39;s Workspace");
  });

  it("reports a provider rejection as not sent", async () => {
    configure();
    sendEmail.mockResolvedValue(false);
    const result = await sendConfirmationEmail(base);
    expect(result.sent).toBe(false);
    if (!result.sent) expect(result.reason).toMatch(/rejected/i);
  });

  it("reports a thrown provider error as not sent", async () => {
    configure();
    sendEmail.mockRejectedValue(new Error("network"));
    const result = await sendConfirmationEmail(base);
    expect(result.sent).toBe(false);
  });
});
