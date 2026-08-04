import { describe, it, expect } from "vitest";
import { resolveBranding, safeColor, safeLogoUrl, DEFAULT_BRANDING } from "../branding";
import { buildHtmlFromEditor } from "../campaign-personalization";

/**
 * brand_colors is unvalidated jsonb and logo_url is unvalidated text. Nothing
 * ever constrained either, because until now nothing read them back - they were
 * write-only fields that a user could set and correctly observe doing nothing.
 *
 * Rendering them changes that: a colour lands inside a style attribute and a
 * logo inside src, so both are now injection surfaces reachable by anyone who
 * can edit workspace settings.
 */

describe("safeColor", () => {
  it("accepts 6-digit and 3-digit hex", () => {
    expect(safeColor("#ff8800", "#000")).toBe("#ff8800");
    expect(safeColor("#f80", "#000")).toBe("#f80");
  });

  it("falls back rather than emitting anything that could close the attribute", () => {
    // The payload that matters: the value sits inside style="color:HERE;".
    expect(safeColor('#fff" onload="alert(1)', "#000")).toBe("#000");
    expect(safeColor("red; background:url(javascript:alert(1))", "#000")).toBe("#000");
    expect(safeColor("</style><script>alert(1)</script>", "#000")).toBe("#000");
  });

  it("falls back on named colours and non-strings", () => {
    // Not dangerous, but the template assumes hex and this keeps it honest.
    expect(safeColor("rebeccapurple", "#000")).toBe("#000");
    expect(safeColor(null, "#000")).toBe("#000");
    expect(safeColor(123, "#000")).toBe("#000");
    expect(safeColor({}, "#000")).toBe("#000");
  });
});

describe("safeLogoUrl", () => {
  it("accepts https", () => {
    expect(safeLogoUrl("https://cdn.example.com/logo.png")).toBe("https://cdn.example.com/logo.png");
  });

  it("rejects javascript: and data: URLs", () => {
    // These land in an img src on a page a browser renders.
    expect(safeLogoUrl("javascript:alert(1)")).toBeNull();
    expect(safeLogoUrl("data:text/html;base64,PHNjcmlwdD4=")).toBeNull();
  });

  it("rejects http, which would be blocked as mixed content anyway", () => {
    expect(safeLogoUrl("http://example.com/logo.png")).toBeNull();
  });

  it("rejects junk without throwing", () => {
    expect(safeLogoUrl("not a url")).toBeNull();
    expect(safeLogoUrl("")).toBeNull();
    expect(safeLogoUrl(null)).toBeNull();
  });
});

describe("resolveBranding", () => {
  it("reads a workspace's colours and logo", () => {
    const b = resolveBranding({
      brand_colors: { primary: "#ff8800", secondary: "#101010" },
      logo_url: "https://cdn.example.com/logo.png",
      sender_name: "Acme Weekly",
      name: "Acme",
    });

    expect(b).toEqual({
      primary: "#ff8800",
      secondary: "#101010",
      logoUrl: "https://cdn.example.com/logo.png",
      name: "Acme Weekly",
    });
  });

  it("prefers sender_name, the name recipients already see in the From header", () => {
    expect(resolveBranding({ sender_name: "Acme Weekly", name: "Acme" }).name).toBe("Acme Weekly");
    expect(resolveBranding({ sender_name: null, name: "Acme" }).name).toBe("Acme");
  });

  it("falls back cleanly for a workspace that has set nothing", () => {
    expect(resolveBranding({})).toEqual(DEFAULT_BRANDING);
    expect(resolveBranding(null)).toEqual(DEFAULT_BRANDING);
  });

  it("survives brand_colors holding something that is not an object", () => {
    // jsonb genuinely permits this and nothing has ever stopped it.
    expect(resolveBranding({ brand_colors: "purple" }).primary).toBe(DEFAULT_BRANDING.primary);
    expect(resolveBranding({ brand_colors: [1, 2, 3] }).primary).toBe(DEFAULT_BRANDING.primary);
  });
});

describe("buildHtmlFromEditor branding", () => {
  it("renders unbranded output identically to before, so existing sends do not change", () => {
    const html = buildHtmlFromEditor("<p>Hi</p>");

    expect(html).toContain("background:#0d0d0d");
    expect(html).toContain("color:#fbbf24");
  });

  it("uses the workspace palette when one is set", () => {
    const html = buildHtmlFromEditor("<p>Hi</p>", "", {
      primary: "#ff8800",
      secondary: "#101010",
      logoUrl: null,
      name: "Acme Weekly",
    });

    expect(html).toContain("background:#101010");
    expect(html).toContain("color:#ff8800");
    expect(html).toContain("Acme Weekly");
    // The header said this regardless of who was sending.
    expect(html).not.toContain("Newsletter Services");
  });

  it("shows the logo instead of the wordmark when one is set", () => {
    const html = buildHtmlFromEditor("<p>Hi</p>", "", {
      ...DEFAULT_BRANDING,
      logoUrl: "https://cdn.example.com/logo.png",
      name: "Acme",
    });

    expect(html).toContain('src="https://cdn.example.com/logo.png"');
    expect(html).toContain('alt="Acme"');
  });

  it("escapes the workspace name rather than interpolating it raw", () => {
    const html = buildHtmlFromEditor("<p>Hi</p>", "", {
      ...DEFAULT_BRANDING,
      name: '<script>alert(1)</script>',
    });

    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("still contains the campaign body", () => {
    expect(buildHtmlFromEditor("<p>Body here</p>")).toContain("<p>Body here</p>");
  });
});
