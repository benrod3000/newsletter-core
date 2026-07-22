import { describe, it, expect } from "vitest";
import { injectTracking } from "../campaign-tracking";

const BASE = "https://mail.test";

describe("injectTracking", () => {
  it("wraps outbound links with the click tracker", () => {
    const html = `<a href="https://example.com/post">Read</a>`;
    const out = injectTracking(html, "camp_1", "sub_1", BASE);

    expect(out).toContain(`${BASE}/api/track/click?c=camp_1&s=sub_1`);
    expect(out).toContain(encodeURIComponent("https://example.com/post"));
  });

  it("appends an open pixel inside body when present", () => {
    const html = `<html><body><p>hi</p></body></html>`;
    const out = injectTracking(html, "camp_1", "sub_1", BASE);

    expect(out).toContain(`${BASE}/api/track/open?c=camp_1&s=sub_1`);
    expect(out.indexOf("/api/track/open")).toBeLessThan(out.indexOf("</body>"));
  });

  it("appends the pixel even without a body tag", () => {
    const out = injectTracking(`<p>hi</p>`, "camp_1", "sub_1", BASE);
    expect(out).toContain("/api/track/open");
  });

  it("does not rewrite the unsubscribe link", () => {
    // Routing unsubscribe through the tracker makes it depend on the tracker
    // being up, and records every unsubscribe as a click.
    const html = `<a href="${BASE}/unsubscribe?token=abc">Unsubscribe</a>`;
    const out = injectTracking(html, "camp_1", "sub_1", BASE);

    expect(out).toContain(`href="${BASE}/unsubscribe?token=abc"`);
    expect(out).not.toContain("track/click?c=camp_1&s=sub_1&u=" + encodeURIComponent(`${BASE}/unsubscribe?token=abc`));
  });

  it("does not rewrite the one-click unsubscribe API link", () => {
    const html = `<a href="${BASE}/api/unsubscribe?token=abc">Unsubscribe</a>`;
    const out = injectTracking(html, "camp_1", "sub_1", BASE);
    expect(out).toContain(`href="${BASE}/api/unsubscribe?token=abc"`);
  });

  it("does not double-wrap an already tracked link", () => {
    const html = `<a href="${BASE}/api/track/click?c=x&s=y&u=z">Link</a>`;
    const out = injectTracking(html, "camp_1", "sub_1", BASE);
    expect(out.match(/api\/track\/click/g)).toHaveLength(1);
  });

  it("escapes ids so they cannot break out of the query string", () => {
    const out = injectTracking(`<a href="https://example.com">x</a>`, "a&b", "c d", BASE);
    expect(out).toContain("c=a%26b");
    expect(out).toContain("s=c%20d");
  });

  it("leaves non-http links alone", () => {
    const html = `<a href="mailto:hi@example.com">Mail</a>`;
    const out = injectTracking(html, "camp_1", "sub_1", BASE);
    expect(out).toContain(`href="mailto:hi@example.com"`);
  });
});
