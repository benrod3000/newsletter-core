import { describe, it, expect } from "vitest";
import { mergeDataForRecipient, type MergeRecipient } from "../campaign-personalization";

const baseRecipient: MergeRecipient = {
  id: "sub_1", email: "test@example.com", country: null, region: null,
  city: null, unsubscribe_token: "tok_1", first_name: null, last_name: null,
  date_of_birth: null, phone_number: null,
};

describe("mergeDataForRecipient — html map", () => {
  it("escapes HTML in subscriber-controlled name fields", () => {
    const malicious: MergeRecipient = {
      ...baseRecipient,
      first_name: "<script>alert(1)</script>",
    };
    const result = mergeDataForRecipient(malicious, "https://x.test/unsub");
    expect(result.html.first_name).not.toContain("<script>");
    expect(result.html.first_name).toContain("&lt;script&gt;");
  });

  it("escapes HTML in city field", () => {
    const malicious: MergeRecipient = {
      ...baseRecipient,
      city: "<img src=x onerror=alert(1)>",
    };
    const result = mergeDataForRecipient(malicious, "https://x.test/unsub");
    expect(result.html.city).not.toContain("<img");
    expect(result.html.city).toContain("&lt;img");
  });

  it("leaves unsubscribe_url unescaped (server-built, not user input)", () => {
    const result = mergeDataForRecipient(
      baseRecipient, "https://x.test/unsub?token=abc&ref=1"
    );
    expect(result.html.unsubscribe_url).toBe("https://x.test/unsub?token=abc&ref=1");
  });
});

describe("mergeDataForRecipient — text map", () => {
  it("does not HTML-escape values used in the plain-text part", () => {
    const recipient: MergeRecipient = { ...baseRecipient, first_name: "O'Brien" };
    const result = mergeDataForRecipient(recipient, "https://x.test/unsub");

    // The text/plain alternative previously reused the escaped map, so
    // subscribers saw "O&#39;Brien" in their inbox.
    expect(result.text.first_name).toBe("O'Brien");
    expect(result.html.first_name).toBe("O&#39;Brien");
  });

  it("keeps ampersands intact in text but escapes them in html", () => {
    const recipient: MergeRecipient = { ...baseRecipient, city: "Bath & Wells" };
    const result = mergeDataForRecipient(recipient, "https://x.test/unsub");

    expect(result.text.city).toBe("Bath & Wells");
    expect(result.html.city).toBe("Bath &amp; Wells");
  });

  it("exposes the same keys in both maps", () => {
    const result = mergeDataForRecipient(baseRecipient, "https://x.test/unsub", "https://x.test/web");
    expect(Object.keys(result.text).sort()).toEqual(Object.keys(result.html).sort());
  });
});
