import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * Delivering the file a capture widget promised.
 *
 * Nothing sent this before. `widgets.download_url` is NOT NULL and the column
 * defaults promise delivery, but the submit handler only wrote an `automation_logs`
 * row for a `subscriber_joined` trigger - and production has no such triggers, so
 * the helper returned without sending. Two people requested a resume through a live
 * widget and received nothing.
 *
 * The properties worth pinning are the ones a passing build cannot see: that an
 * unconfigured platform is reported rather than assumed, that the link is wrapped
 * for click tracking so `lead_magnet_claimed` can ever be true, and that the
 * message carries an opt-out.
 */

const sendEmail = vi.fn();

vi.mock("../email-sender", async () => {
  const actual = await vi.importActual<typeof import("../email-sender")>("../email-sender");
  return { ...actual, sendEmail: (...args: unknown[]) => sendEmail(...args) };
});

import { sendLeadMagnetEmail, buildTrackedLeadMagnetUrl } from "../email/lead-magnet";

const saved = { ...process.env };

const base = {
  email: "someone@example.com",
  subscriberId: "11111111-1111-4111-8111-111111111111",
  leadUrl: "https://brod3000.com/images/resume.pdf",
  leadTitle: "Resume - 2026",
  unsubscribeToken: "22222222-2222-4222-8222-222222222222",
  host: "newsletter-core.vercel.app",
};

function configure() {
  process.env.RESEND_API_KEY = "re_test";
  process.env.TRANSACTIONAL_FROM_EMAIL = "noreply@brod3000.com";
}

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

describe("buildTrackedLeadMagnetUrl", () => {
  it("wraps the destination in a tracked click marked as a lead magnet", () => {
    // `kind=lead_magnet` is what `app/admin/page.tsx` filters on to derive
    // lead_magnet_claimed, and what campaign_audience()'s claimed_offer reads.
    const url = buildTrackedLeadMagnetUrl({
      appUrl: "https://newsletter-core.vercel.app",
      subscriberId: base.subscriberId,
      leadUrl: base.leadUrl,
      leadTitle: base.leadTitle,
    });

    expect(url).toContain("/api/track/click");
    expect(url).toContain(`s=${base.subscriberId}`);
    expect(url).toContain("kind=lead_magnet");
  });

  it("double-encodes the destination, because track/click decodes once", () => {
    // Dropping the inner encodeURIComponent breaks any destination that has a
    // query string of its own - its params would be read as track/click's.
    const url = buildTrackedLeadMagnetUrl({
      appUrl: "https://newsletter-core.vercel.app",
      subscriberId: base.subscriberId,
      leadUrl: "https://example.com/f.pdf?v=2&t=a",
      leadTitle: null,
    });

    const u = new URL(url).searchParams.get("u")!;
    expect(decodeURIComponent(u)).toBe("https://example.com/f.pdf?v=2&t=a");
  });
});

describe("sendLeadMagnetEmail", () => {
  it("reports a reason instead of sending when the platform is unconfigured", async () => {
    const result = await sendLeadMagnetEmail(base);
    expect(result.sent).toBe(false);
    if (!result.sent) expect(result.reason).toMatch(/not configured/i);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("sends the tracked link, not the raw file URL", async () => {
    configure();
    const result = await sendLeadMagnetEmail(base);

    expect(result.sent).toBe(true);
    const [params] = sendEmail.mock.calls[0];
    expect(params.html).toContain("/api/track/click");
    expect(params.html).not.toContain(`href="${base.leadUrl}"`);
  });

  it("carries an opt-out in the body as well as the header", async () => {
    // CAN-SPAM wants the mechanism in the message. A widget subscriber is on a
    // list now, so this is not an exempt transactional send.
    configure();
    await sendLeadMagnetEmail(base);

    const [params] = sendEmail.mock.calls[0];
    expect(params.html).toContain(`/unsubscribe?token=${base.unsubscribeToken}`);
    expect(params.text).toContain(`/unsubscribe?token=${base.unsubscribeToken}`);
    expect(params.listUnsubscribe).toContain(base.unsubscribeToken);
  });

  it("still sends when there is no unsubscribe token, without a broken link", async () => {
    configure();
    const result = await sendLeadMagnetEmail({ ...base, unsubscribeToken: null });

    expect(result.sent).toBe(true);
    const [params] = sendEmail.mock.calls[0];
    expect(params.html).not.toContain("/unsubscribe?token=");
    expect(params.listUnsubscribe).toBeUndefined();
  });

  it("escapes a widget-supplied title", async () => {
    configure();
    await sendLeadMagnetEmail({ ...base, leadTitle: '<script>alert(1)</script>' });

    const [params] = sendEmail.mock.calls[0];
    expect(params.html).not.toContain("<script>");
    expect(params.html).toContain("&lt;script&gt;");
  });

  it("falls back to a generic label when the widget has no title", async () => {
    configure();
    await sendLeadMagnetEmail({ ...base, leadTitle: null });

    const [params] = sendEmail.mock.calls[0];
    expect(params.subject).toBe("Here's your download");
  });

  it("uses the operator's subject and body when the widget has them", async () => {
    configure();
    await sendLeadMagnetEmail({
      ...base,
      emailSubject: "Your copy of my resume",
      emailBody: "Thanks for asking.\n\n{{download_link}}\n\nBen",
    });

    const [params] = sendEmail.mock.calls[0];
    expect(params.subject).toBe("Your copy of my resume");
    expect(params.html).toContain("Thanks for asking.");
    expect(params.html).toContain("Ben");
    // The tag is replaced by the button, not left sitting in the message.
    expect(params.html).not.toContain("{{download_link}}");
    expect(params.text).not.toContain("{{download_link}}");
    expect(params.html).toContain("/api/track/click");
    expect(params.text).toContain("/api/track/click");
  });

  it("appends the button when the operator omits the merge tag", async () => {
    // Otherwise a body with no tag sends a delivery email containing no way to
    // reach the file - the exact failure this feature exists to fix.
    configure();
    await sendLeadMagnetEmail({ ...base, emailBody: "Here you go." });

    const [params] = sendEmail.mock.calls[0];
    expect(params.html).toContain("Here you go.");
    expect(params.html).toContain("/api/track/click");
    expect(params.text).toContain("/api/track/click");
  });

  it("escapes an operator-written body rather than trusting it as HTML", async () => {
    // Widget config is editable by any workspace member and this text is mailed to
    // subscribers, so it is content, not markup.
    configure();
    await sendLeadMagnetEmail({
      ...base,
      emailBody: "<script>alert(1)</script> and <b>bold</b>",
    });

    const [params] = sendEmail.mock.calls[0];
    expect(params.html).not.toContain("<script>");
    expect(params.html).not.toContain("<b>bold</b>");
    expect(params.html).toContain("&lt;script&gt;");
  });

  it("falls back to the built-in copy when the fields are blank", async () => {
    // Blank has to mean "use the default", not "send an empty email".
    configure();
    await sendLeadMagnetEmail({ ...base, emailSubject: "   ", emailBody: "  " });

    const [params] = sendEmail.mock.calls[0];
    expect(params.subject).toBe("Here's Resume - 2026");
    expect(params.html).toContain("Thanks for asking");
    expect(params.html).toContain("/api/track/click");
  });

  it("reports a provider rejection as not sent", async () => {
    configure();
    sendEmail.mockResolvedValue(false);
    const result = await sendLeadMagnetEmail(base);
    expect(result.sent).toBe(false);
  });
});
