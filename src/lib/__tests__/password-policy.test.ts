import { describe, it, expect } from "vitest";
import { MIN_PASSWORD_LENGTH, passwordProblem } from "../password-policy";

/**
 * The password rule was written out four times across two repos, all saying 6.
 * These tests exist so a raise cannot be half-applied: the constant is asserted
 * directly, and the frontend has a mirror of this file asserting the same number.
 */

describe("password policy", () => {
  it("requires at least 12 characters", () => {
    // Pinned rather than derived from the constant - the point is to notice if
    // the number moves, not to restate whatever it happens to be.
    expect(MIN_PASSWORD_LENGTH).toBe(12);
  });

  it("rejects a password one character short", () => {
    expect(passwordProblem("a".repeat(MIN_PASSWORD_LENGTH - 1))).toMatch(/at least 12/i);
  });

  it("accepts a password at exactly the minimum", () => {
    expect(passwordProblem("a".repeat(MIN_PASSWORD_LENGTH))).toBeNull();
  });

  it("accepts a long passphrase with no digits or symbols", () => {
    // No composition rules on purpose: requiring a digit and a symbol pushes
    // people toward Password1! and away from this, which is stronger.
    expect(passwordProblem("correct horse battery staple")).toBeNull();
  });

  it("has no upper bound that a password manager could trip", () => {
    expect(passwordProblem("x".repeat(200))).toBeNull();
  });

  it("treats an empty or missing password as missing, not as too short", () => {
    expect(passwordProblem("")).toMatch(/enter a password/i);
    expect(passwordProblem(undefined)).toMatch(/enter a password/i);
    expect(passwordProblem(null)).toMatch(/enter a password/i);
  });

  it("rejects a non-string without throwing", () => {
    // The routes hand it straight off a parsed JSON body.
    expect(passwordProblem(123456789012)).toMatch(/enter a password/i);
    expect(passwordProblem({})).toMatch(/enter a password/i);
  });
});
