import { describe, it, expect } from "vitest";
import { sanitizeCampaignHtml, sanitizeCampaignCss } from "@/lib/sanitize-campaign-html";

describe("sanitizeCampaignHtml", () => {
  it("strips script tags but keeps surrounding content", () => {
    const out = sanitizeCampaignHtml("<p>before</p><script>alert(1)</script><p>after</p>");
    expect(out).not.toContain("<script");
    expect(out).not.toContain("alert(1)");
    expect(out).toContain("<p>before</p>");
    expect(out).toContain("<p>after</p>");
  });

  it("strips inline event handlers", () => {
    const out = sanitizeCampaignHtml(`<img src="x" onerror="alert(1)">`);
    expect(out).not.toContain("onerror");
    expect(out).not.toContain("alert");
  });

  it("drops javascript: hrefs without dropping the link text", () => {
    const out = sanitizeCampaignHtml(`<a href="javascript:alert(1)">click</a>`);
    expect(out).not.toContain("javascript:");
    expect(out).toContain("click");
  });

  it("removes framing and object embeds", () => {
    expect(sanitizeCampaignHtml(`<iframe src="https://evil.com"></iframe>`)).not.toContain("iframe");
    expect(sanitizeCampaignHtml(`<object data="x"></object>`)).not.toContain("object");
    expect(sanitizeCampaignHtml(`<svg onload="alert(1)"></svg>`)).not.toContain("onload");
  });

  /**
   * The web version is rendered from the same editor HTML as the email, so it
   * still contains unexpanded merge tags at sanitise time. Stripping them would
   * silently break the unsubscribe link on every archived campaign.
   */
  it("preserves merge tags in both text and href position", () => {
    expect(sanitizeCampaignHtml("<p>Hi {{first_name}}</p>")).toContain("{{first_name}}");

    const link = sanitizeCampaignHtml(`<a href="{{unsubscribe_url}}">Unsubscribe</a>`);
    expect(link).toContain("{{unsubscribe_url}}");
    expect(link).toContain("Unsubscribe");
  });

  it("keeps ordinary newsletter markup intact", () => {
    const input = `<table width="600"><tr><td style="color:red" colspan="2"><h1>Title</h1><p>Body <strong>bold</strong></p></td></tr></table>`;
    const out = sanitizeCampaignHtml(input);
    expect(out).toContain("<table");
    expect(out).toContain('style="color:red"');
    expect(out).toContain("<h1>Title</h1>");
    expect(out).toContain("<strong>bold</strong>");
  });

  it("adds noopener to outbound links", () => {
    expect(sanitizeCampaignHtml(`<a href="https://example.com">x</a>`)).toContain('rel="noopener noreferrer"');
  });

  it("returns an empty string for null or undefined", () => {
    expect(sanitizeCampaignHtml(null)).toBe("");
    expect(sanitizeCampaignHtml(undefined)).toBe("");
  });
});

describe("sanitizeCampaignCss", () => {
  it("neutralises a </style> breakout", () => {
    const out = sanitizeCampaignCss("body{color:red}</style><script>alert(1)</script>");
    expect(out).not.toContain("</style>");
    expect(out).not.toContain("<script");
  });

  it("keeps the child combinator, which real stylesheets need", () => {
    expect(sanitizeCampaignCss("nav > a { color: blue }")).toContain("nav > a");
  });

  it("blocks @import so a stylesheet cannot beacon to a third party", () => {
    expect(sanitizeCampaignCss("@import url(https://evil.com/x.css);")).not.toMatch(/@import/i);
  });

  it("returns an empty string for null or undefined", () => {
    expect(sanitizeCampaignCss(null)).toBe("");
    expect(sanitizeCampaignCss(undefined)).toBe("");
  });
});
