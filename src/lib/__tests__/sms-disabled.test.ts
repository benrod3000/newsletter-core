import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { smsEnabled } from "../features";

/**
 * SMS stays off until it goes through the durable pipeline.
 *
 * Email sends via a per-recipient queue with a FOR UPDATE SKIP LOCKED claim,
 * consent re-checked at dispatch, and a recovery job. SMS sends in a `for` loop
 * inside the request handler, caps the audience at 500 without saying so, keeps
 * no per-recipient state and has no idempotency - a timeout partway through
 * leaves nothing that knows who was already texted, so a retry texts them again.
 *
 * The flag is enforced on the server as well as in the UI, because hiding a
 * button does not stop a session token and curl, and the failure being guarded
 * against is messaging real people twice.
 *
 * These tests pin the enforcement, not the value: flipping SMS_ENABLED to work
 * on it locally is expected. What must not happen is a send route quietly losing
 * its guard during that work.
 */

const ROOT = process.cwd();
const original = process.env.SMS_ENABLED;

afterEach(() => {
  if (original === undefined) delete process.env.SMS_ENABLED;
  else process.env.SMS_ENABLED = original;
});

describe("smsEnabled", () => {
  it("is off unless explicitly enabled", () => {
    delete process.env.SMS_ENABLED;
    expect(smsEnabled()).toBe(false);
    process.env.SMS_ENABLED = "false";
    expect(smsEnabled()).toBe(false);
    // Not truthy-checked: "0" and "no" are the kind of value that reads as off
    // to a human and on to JavaScript.
    process.env.SMS_ENABLED = "1";
    expect(smsEnabled()).toBe(false);
  });

  it("is on for exactly the string true", () => {
    process.env.SMS_ENABLED = "true";
    expect(smsEnabled()).toBe(true);
  });

  it("is read per call, not latched at import", () => {
    // A module-load read would mean a redeploy to change it, and would make this
    // test order-dependent.
    process.env.SMS_ENABLED = "true";
    expect(smsEnabled()).toBe(true);
    process.env.SMS_ENABLED = "false";
    expect(smsEnabled()).toBe(false);
  });
});

describe("SMS routes", () => {
  const routes = [
    "app/api/clients/[workspaceId]/campaigns/sms/route.ts",
    "app/api/clients/[workspaceId]/sms/test/route.ts",
  ];

  const GUARD = "if (!smsEnabled()) return smsDisabledResponse();";

  it("guard every exported handler, as the first statement", () => {
    for (const rel of routes) {
      const lines = readFileSync(join(ROOT, rel), "utf8").split("\n");

      const handlerStarts = lines
        .map((l, i) => ({ l, i }))
        .filter(({ l }) => /^export (?:async )?function (?:POST|GET|PATCH|DELETE)\(/.test(l));

      expect(handlerStarts.length, `${rel} exports no handlers - did the file move?`)
        .toBeGreaterThan(0);

      for (const { i } of handlerStarts) {
        // Walk to the line after the opening brace, then to the first line that
        // is actually code. Position, not presence: a guard placed after an
        // await is a guard that does not guard, and searching the whole file for
        // the string would also match it inside a comment.
        // The line that *opens the body*, not the first line containing a
        // brace - these signatures destructure `{ params }`, so "contains {"
        // stops inside the parameter list.
        let j = i;
        while (j < lines.length && !/\{\s*$/.test(lines[j])) j++;
        j++;
        while (j < lines.length) {
          const t = lines[j].trim();
          if (t === "" || t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) { j++; continue }
          break;
        }
        expect(
          lines[j]?.trim(),
          `${rel}: the handler starting at line ${i + 1} does something before checking the flag`
        ).toBe(GUARD);
      }
    }
  });
});
