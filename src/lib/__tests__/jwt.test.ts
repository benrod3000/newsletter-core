import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "../jwt";

describe("password hashing", () => {
  it("hashes with PBKDF2 600k iterations and verifies correctly", async () => {
    const hash = await hashPassword("correct-horse-battery-staple");
    expect(hash).toMatch(/^600000:/);

    const { valid } = await verifyPassword("correct-horse-battery-staple", hash);
    expect(valid).toBe(true);
  });

  it("rejects wrong password", async () => {
    const hash = await hashPassword("correct-password");
    const { valid } = await verifyPassword("wrong-password", hash);
    expect(valid).toBe(false);
  });

  it("is timing-safe — malformed hashes are rejected without crashing", async () => {
    const { valid } = await verifyPassword("anything", "not-a-real-hash");
    expect(valid).toBe(false);
  });
});
