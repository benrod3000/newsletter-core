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
import { DEFAULT_BRANDING } from "../branding";

const saved = { ...process.env };

const base = {
  email: "someone@example.com",
  subscriberId: "11111111-1111-4111-8111-111111111111",
  leadUrl: "https://brod3000.com/images/resume.pdf",
  leadTitle: "Resume - 2026",
  unsubscribeToken: "22222222-2222-4222-8222-222222222222",
  baseUrl: "https://newsletter-core.vercel.app",
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

  it("builds links on the given baseUrl, ignoring APP_URL entirely", async () => {
    // The bug this pins: the first version read `APP_URL ?? NEXT_PUBLIC_APP_URL`,
    // and APP_URL is the *frontend* - it builds /dashboard and reset links. So
    // every tracked link went to the React app, which has no /api/track/click and
    // served its 404 page. The email arrived, the link was dead, and no server-side
    // check could see it. baseUrl is now passed in and APP_URL must not win.
    configure();
    process.env.APP_URL = "https://newsletter.brod3000.com";

    await sendLeadMagnetEmail({ ...base, baseUrl: "https://api.example.com" });

    const [params] = sendEmail.mock.calls[0];
    expect(params.html).toContain("https://api.example.com/api/track/click");
    expect(params.html).not.toContain("newsletter.brod3000.com");
    expect(params.html).toContain("https://api.example.com/unsubscribe?token=");
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
    expect(params.html).toContain("as requested");
    expect(params.html).toContain("/api/track/click");
  });

  it("uses the workspace's logo and colours", async () => {
    // The first email a subscriber ever receives was fixed dark grey with an amber
    // button whatever the workspace had set, so a form on a branded site sent
    // something that looked like it came from elsewhere.
    configure();
    await sendLeadMagnetEmail({
      ...base,
      branding: {
        primary: "#2b7657",
        secondary: "#101014",
        logoUrl: "https://brod3000.com/logo.png",
        name: "Brod3000",
      },
    });

    const [params] = sendEmail.mock.calls[0];
    // secondary is the ink - borders and headline type - and primary is the fill.
    expect(params.html).toContain("solid #101014");
    expect(params.html).toContain("background:#2b7657");
    expect(params.html).toContain('src="https://brod3000.com/logo.png"');
    // The logo replaces the wordmark rather than sitting alongside it.
    expect(params.html).not.toContain("letter-spacing:0.1em");
  });

  it("sends under the workspace's name, not the product's", async () => {
    // The From read "Veloce <noreply@brod3000.com>" - the product's name on a
    // message a subscriber requested from a person. The address must not move: it
     // is what SPF and DKIM are bound to.
    configure();
    await sendLeadMagnetEmail({
      ...base,
      branding: { ...DEFAULT_BRANDING, name: "Brod3000" },
    });

    const [params] = sendEmail.mock.calls[0];
    expect(params.from).toBe("Brod3000 <noreply@brod3000.com>");
  });

  it("cannot put a second address, or anything resembling one, in the From header", async () => {
    // The name is tenant-controlled. Stripping only header punctuation still left
    // `Evil attacker@example.com x` as the display name - harmless to the parser and
    // convincing to a human, which is the part that matters.
    configure();
    await sendLeadMagnetEmail({
      ...base,
      branding: { ...DEFAULT_BRANDING, name: 'Evil" <attacker@example.com>, x' },
    });

    const [params] = sendEmail.mock.calls[0];
    expect(params.from).toContain("<noreply@brod3000.com>");
    // Exactly one address, and no @ anywhere in the display name.
    expect(params.from.match(/@/g)).toHaveLength(1);
    expect(params.from).not.toContain("<attacker");
  });

  it("keeps the From header on one line", async () => {
    configure();
    await sendLeadMagnetEmail({
      ...base,
      branding: { ...DEFAULT_BRANDING, name: "Brod\r\nBcc: someone@example.com" },
    });

    const [params] = sendEmail.mock.calls[0];
    expect(params.from).not.toMatch(/[\r\n]/);
  });

  it("names the sender by brand, not by the widget's internal label", async () => {
    // audienceName used to be the widget's `name`, so a resume form said
    // "Thanks for asking about RESUME".
    configure();
    await sendLeadMagnetEmail({
      ...base,
      audienceName: null,
      branding: { ...DEFAULT_BRANDING, name: "Brod3000" },
    });

    const [params] = sendEmail.mock.calls[0];
    expect(params.html).toContain("Brod3000");
    expect(params.html).not.toContain("RESUME");
  });

  it("shows a wordmark when the workspace has no logo", async () => {
    configure();
    await sendLeadMagnetEmail({
      ...base,
      branding: { primary: "#2b7657", secondary: "#101014", logoUrl: null, name: "Brod3000" },
    });

    const [params] = sendEmail.mock.calls[0];
    expect(params.html).toContain("Brod3000");
    expect(params.html).not.toContain("<img");
  });

  it("picks button text that is readable on the brand colour", async () => {
    // A hardcoded black label is fine on amber and invisible on navy, and the
    // recipient cannot restyle an email to recover.
    configure();
    await sendLeadMagnetEmail({
      ...base,
      branding: { ...DEFAULT_BRANDING, primary: "#101040" },
    });
    expect(sendEmail.mock.calls[0][0].html).toContain("color:#ffffff");

    sendEmail.mockClear();
    await sendLeadMagnetEmail({
      ...base,
      branding: { ...DEFAULT_BRANDING, primary: "#fbbf24" },
    });
    expect(sendEmail.mock.calls[0][0].html).toContain("color:#000000");
  });

  it("uses the operator's headline as the large type", async () => {
    // Its own field, not the first line of the body: it renders at a different
    // size, and folding it in would mean guessing which paragraph to shout.
    configure();
    await sendLeadMagnetEmail({ ...base, emailHeading: "Thanks for your interest." });

    const [params] = sendEmail.mock.calls[0];
    // The <h1> carries the operator's words rather than a generated "Here's <file>".
    expect(params.html).toMatch(/<h1[^>]*>\s*Thanks for your interest\./);
    expect(params.html).not.toMatch(/<h1[^>]*>\s*Here&#39;s/);
  });

  it("escapes the headline", async () => {
    configure();
    await sendLeadMagnetEmail({ ...base, emailHeading: "<img src=x onerror=1>" });

    const [params] = sendEmail.mock.calls[0];
    expect(params.html).not.toContain("<img src=x");
    expect(params.html).toContain("&lt;img src=x");
  });

  it("linkifies a bare domain in the body", async () => {
    // A signature reading "brod3000.com" should be clickable. Operators write plain
    // text here - they have no way to author an anchor.
    configure();
    await sendLeadMagnetEmail({ ...base, emailBody: "Ben Rodriguez\nbrod3000.com" });

    const [params] = sendEmail.mock.calls[0];
    expect(params.html).toContain('href="https://brod3000.com"');
  });

  it("does not let linkifying reintroduce markup", async () => {
    // Linkifying runs after escaping, so an escaped tag must stay escaped.
    configure();
    await sendLeadMagnetEmail({
      ...base,
      emailBody: '<a href="https://evil.example">click</a>',
    });

    const [params] = sendEmail.mock.calls[0];
    expect(params.html).not.toContain('<a href="https://evil.example">click</a>');
    expect(params.html).toContain("&lt;a href=");
  });

  it("always offers the raw link as a fallback to the button", async () => {
    // Images and buttons get stripped by some clients and corporate gateways.
    configure();
    await sendLeadMagnetEmail(base);

    const [params] = sendEmail.mock.calls[0];
    expect(params.html).toContain("If the button does not work");
    expect(params.text).toContain("/api/track/click");
  });

  it("still delivers the file when the widget does not subscribe anyone", async () => {
    // One-time delivery is the default for a lead magnet: the visitor asked for a
    // file, not for future mail. The delivery itself must be unaffected - the
    // opt-out link included, since they are still receiving a message.
    configure();
    const result = await sendLeadMagnetEmail(base);

    expect(result.sent).toBe(true);
    const [params] = sendEmail.mock.calls[0];
    expect(params.html).toContain("/api/track/click");
    expect(params.html).toContain("/unsubscribe?token=");
  });

  it("reports a provider rejection as not sent", async () => {
    configure();
    sendEmail.mockResolvedValue(false);
    const result = await sendLeadMagnetEmail(base);
    expect(result.sent).toBe(false);
  });
});
