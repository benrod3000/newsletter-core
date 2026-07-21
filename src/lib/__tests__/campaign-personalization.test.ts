import { describe, it, expect } from "vitest";
import { mergeDataForRecipient, type MergeRecipient } from "../campaign-personalization";

const baseRecipient: MergeRecipient = {
  id: "sub_1", email: "test@example.com", country: null, region: null,
  city: null, unsubscribe_token: "tok_1", first_name: null, last_name: null,
  date_of_birth: null, phone_number: null,
};

describe("mergeDataForRecipient", () => {
  it("escapes HTML in subscriber-controlled name fields", () => {
    const malicious: MergeRecipient = {
      ...baseRecipient,
      first_name: "<script>alert(1)</script>",
    };
    const result = mergeDataForRecipient(malicious, "https://x.test/unsub");
    expect(result.first_name).not.toContain("<script>");
    expect(result.first_name).toContain("&lt;script&gt;");
  });

  it("escapes HTML in city field", () => {
    const malicious: MergeRecipient = {
      ...baseRecipient,
      city: "<img src=x onerror=alert(1)>",
    };
    const result = mergeDataForRecipient(malicious, "https://x.test/unsub");
    expect(result.city).not.toContain("<img");
    expect(result.city).toContain("&lt;img");
  });

  it("leaves unsubscribe_url unescaped (server-built, not user input)", () => {
    const result = mergeDataForRecipient(
      baseRecipient, "https://x.test/unsub?token=abc&ref=1"
    );
    expect(result.unsubscribe_url).toBe("https://x.test/unsub?token=abc&ref=1");
  });
});
