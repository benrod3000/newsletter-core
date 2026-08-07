import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  resolveTransactionalConfig,
  TransactionalEmailNotConfigured,
  sendTransactionalEmail,
} from "../email-sender";

/**
 * Platform email: password resets and the signup welcome.
 *
 * This function threw on its first line for the entire life of the project. It
 * required SENDGRID_API_KEY and SENDGRID_FROM_EMAIL, neither of which has ever
 * existed in this project's Vercel environment, and both callers invoked it
 * fire-and-forget with `.catch(console.error)` before returning success. So
 * password reset reported "check your email" and sent nothing, and no test,
 * type or build step could have told anyone.
 */

const saved = { ...process.env };

beforeEach(() => {
  delete process.env.RESEND_API_KEY;
  delete process.env.SENDGRID_API_KEY;
  delete process.env.TRANSACTIONAL_FROM_EMAIL;
  delete process.env.SENDGRID_FROM_EMAIL;
  delete process.env.TRANSACTIONAL_FROM_NAME;
});

afterEach(() => {
  process.env = { ...saved };
});

describe("resolveTransactionalConfig", () => {
  it("reports what is missing when nothing is set", () => {
    const r = resolveTransactionalConfig();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.missing).toContain("RESEND_API_KEY or SENDGRID_API_KEY");
      expect(r.missing).toContain("TRANSACTIONAL_FROM_EMAIL");
    }
  });

  it("reports a missing from address even when a key is present", () => {
    // The exact half-configured state that is easiest to ship by accident.
    process.env.RESEND_API_KEY = "re_test";
    const r = resolveTransactionalConfig();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toEqual(["TRANSACTIONAL_FROM_EMAIL"]);
  });

  it("uses Resend when configured", () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.TRANSACTIONAL_FROM_EMAIL = "noreply@brod3000.com";
    const r = resolveTransactionalConfig();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.config.provider).toBe("resend");
      expect(r.config.resendApiKey).toBe("re_test");
      expect(r.from).toBe("Veloce <noreply@brod3000.com>");
    }
  });

  it("still works on SendGrid alone, so an existing setup does not regress", () => {
    process.env.SENDGRID_API_KEY = "SG.test";
    process.env.SENDGRID_FROM_EMAIL = "noreply@example.com";
    const r = resolveTransactionalConfig();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.config.provider).toBe("sendgrid");
      expect(r.from).toContain("noreply@example.com");
    }
  });

  it("prefers Resend when both are configured", () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.SENDGRID_API_KEY = "SG.test";
    process.env.TRANSACTIONAL_FROM_EMAIL = "noreply@brod3000.com";
    const r = resolveTransactionalConfig();
    if (r.ok) expect(r.config.provider).toBe("resend");
  });

  it("prefers the transactional from address over the SendGrid one", () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.TRANSACTIONAL_FROM_EMAIL = "noreply@brod3000.com";
    process.env.SENDGRID_FROM_EMAIL = "old@example.com";
    const r = resolveTransactionalConfig();
    if (r.ok) expect(r.from).toContain("noreply@brod3000.com");
  });

  it("allows the sender name to be overridden", () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.TRANSACTIONAL_FROM_EMAIL = "noreply@brod3000.com";
    process.env.TRANSACTIONAL_FROM_NAME = "Brod3000";
    const r = resolveTransactionalConfig();
    if (r.ok) expect(r.from).toBe("Brod3000 <noreply@brod3000.com>");
  });
});

describe("sendTransactionalEmail", () => {
  it("throws a named error when unconfigured, rather than failing obscurely", async () => {
    // Named so a caller can tell misconfiguration from a provider rejection,
    // and so the message says which variable to set.
    await expect(
      sendTransactionalEmail({ to: "a@b.com", subject: "x", html: "<p>x</p>" })
    ).rejects.toBeInstanceOf(TransactionalEmailNotConfigured);
  });

  it("names the missing variables in the error", async () => {
    await expect(
      sendTransactionalEmail({ to: "a@b.com", subject: "x", html: "<p>x</p>" })
    ).rejects.toThrow(/TRANSACTIONAL_FROM_EMAIL/);
  });
});
