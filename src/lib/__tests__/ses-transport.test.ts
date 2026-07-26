import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the AWS SDK before importing the transport.
const sendMock = vi.fn();
vi.mock("@aws-sdk/client-ses", () => ({
  SESClient: vi.fn().mockImplementation(() => ({ send: sendMock })),
  SendRawEmailCommand: vi.fn().mockImplementation((input) => ({ __cmd: "SendRawEmail", input })),
  GetSendQuotaCommand: vi.fn().mockImplementation((input) => ({ __cmd: "GetSendQuota", input })),
}));

import { SESTransport, buildRawMessage, mapSesError } from "@/lib/email/ses";
import { registry } from "@/lib/email/registry";

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

describe("buildRawMessage", () => {
  it("emits List-Unsubscribe headers and a multipart body when html+text are present", () => {
    const raw = buildRawMessage(
      {
        to: "sub@example.com",
        from: "hello@veloce.app",
        fromName: "Veloce",
        subject: "Hi there",
        html: "<p>Hello</p>",
        text: "Hello",
        replyTo: "reply@veloce.app",
        listUnsubscribe: "https://veloce.app/u/abc",
      },
      "BOUND",
    );

    expect(raw).toContain("From: Veloce <hello@veloce.app>");
    expect(raw).toContain("To: sub@example.com");
    expect(raw).toContain("Reply-To: reply@veloce.app");
    expect(raw).toContain("Subject: Hi there");
    expect(raw).toContain("List-Unsubscribe: <https://veloce.app/u/abc>");
    expect(raw).toContain("List-Unsubscribe-Post: List-Unsubscribe=One-Click");
    expect(raw).toContain('Content-Type: multipart/alternative; boundary="BOUND"');
    expect(raw).toContain("--BOUND");
    expect(raw).toContain("--BOUND--");
    expect(raw).toContain("Content-Type: text/plain; charset=UTF-8");
    expect(raw).toContain("Content-Type: text/html; charset=UTF-8");
    expect(raw).toContain(b64("Hello"));
    expect(raw).toContain(b64("<p>Hello</p>"));
    // CRLF line endings throughout
    expect(raw).toContain("\r\n");
  });

  it("uses a single text/html part when only html is present", () => {
    const raw = buildRawMessage({ to: "a@b.com", from: "f@g.com", subject: "S", html: "<b>x</b>" }, "B");
    expect(raw).toContain("Content-Type: text/html; charset=UTF-8");
    expect(raw).not.toContain("multipart/alternative");
    expect(raw).toContain(b64("<b>x</b>"));
  });

  it("RFC 2047-encodes non-ASCII subjects and from names", () => {
    const raw = buildRawMessage({ to: "a@b.com", from: "f@g.com", fromName: "Café", subject: "Niño 🎉", text: "hi" }, "B");
    expect(raw).toContain(`Subject: =?UTF-8?B?${b64("Niño 🎉")}?=`);
    expect(raw).toContain(`From: =?UTF-8?B?${b64("Café")}?= <f@g.com>`);
  });

  it("does not duplicate reserved headers supplied via params.headers", () => {
    const raw = buildRawMessage(
      { to: "a@b.com", from: "f@g.com", subject: "S", text: "hi", headers: { "List-Unsubscribe": "<evil>", "X-Custom": "1" } },
      "B",
    );
    expect(raw).toContain("X-Custom: 1");
    expect(raw).not.toContain("<evil>");
  });

  /**
   * The header block is everything before the first blank line. Injection is
   * only prevented if no *new line* starts with the smuggled header name —
   * the text itself surviving, folded into the value it came from, is the
   * intended outcome, not a leak.
   */
  const headerNames = (raw: string) =>
    raw
      .split("\r\n\r\n")[0]
      .split("\r\n")
      .map((line) => line.split(":")[0].trim().toLowerCase());

  // A subject reaches buildRawMessage already rendered, so `{{first_name}}` in
  // the subject line puts the recipient's own profile text into a MIME header.
  it("neutralises CRLF injected through a subject merge tag", () => {
    const raw = buildRawMessage(
      {
        to: "a@b.com",
        from: "f@g.com",
        subject: "Hi Bob\r\nBcc: victim@evil.com\r\nX-Injected: yes",
        text: "hi",
      },
      "B",
    );

    const names = headerNames(raw);
    expect(names).not.toContain("bcc");
    expect(names).not.toContain("x-injected");
    // Flattened onto the one Subject line rather than starting new headers.
    expect(raw).toContain("Subject: Hi Bob Bcc: victim@evil.com X-Injected: yes");
    expect(names.filter((n) => n === "subject")).toHaveLength(1);
  });

  it("neutralises CRLF in from name, address, to and reply-to", () => {
    const raw = buildRawMessage(
      {
        to: "a@b.com\r\nBcc: sneak@evil.com",
        from: "f@g.com\r\nX-From: bad",
        fromName: "Ada\r\nX-Name: bad",
        replyTo: "r@g.com\r\nX-Reply: bad",
        subject: "S",
        text: "hi",
      },
      "B",
    );

    const names = headerNames(raw);
    expect(names).not.toContain("bcc");
    expect(names).not.toContain("x-from");
    expect(names).not.toContain("x-name");
    expect(names).not.toContain("x-reply");
    // Exactly the headers we control, one line each.
    expect(names.filter((n) => n === "to")).toHaveLength(1);
    expect(names.filter((n) => n === "from")).toHaveLength(1);
    expect(names.filter((n) => n === "reply-to")).toHaveLength(1);
  });

  it("drops custom headers whose name is not a bare token", () => {
    const raw = buildRawMessage(
      {
        to: "a@b.com",
        from: "f@g.com",
        subject: "S",
        text: "hi",
        headers: { "X-Bad: injected\r\nBcc": "x", "X-Good": "1" },
      },
      "B",
    );

    expect(raw).toContain("X-Good: 1");
    expect(raw).not.toContain("X-Bad");
    expect(raw).not.toContain("Bcc");
  });
});

describe("mapSesError", () => {
  it("classifies throttling as retryable RATE_LIMITED", () => {
    const m = mapSesError({ name: "ThrottlingException", $metadata: { httpStatusCode: 429 }, message: "slow down" });
    expect(m.error.code).toBe("RATE_LIMITED");
    expect(m.error.retryable).toBe(true);
  });

  it("classifies auth failures as permanent AUTH_FAILED", () => {
    const m = mapSesError({ name: "InvalidClientTokenId", $metadata: { httpStatusCode: 403 }, message: "bad key" });
    expect(m.error.code).toBe("AUTH_FAILED");
    expect(m.error.retryable).toBe(false);
  });

  it("classifies an unverified sender as permanent PROVIDER_ERROR", () => {
    const m = mapSesError({ name: "MessageRejected", $metadata: { httpStatusCode: 400 }, message: "Email address is not verified" });
    expect(m.error.code).toBe("PROVIDER_ERROR");
    expect(m.error.retryable).toBe(false);
  });

  it("treats 5xx as retryable and missing metadata as NETWORK_ERROR", () => {
    expect(mapSesError({ name: "InternalFailure", $metadata: { httpStatusCode: 500 }, message: "x" }).error.retryable).toBe(true);
    const net = mapSesError({ message: "socket hang up" });
    expect(net.error.code).toBe("NETWORK_ERROR");
    expect(net.error.retryable).toBe(true);
  });
});

describe("SESTransport", () => {
  beforeEach(() => sendMock.mockReset());

  const creds = { accessKeyId: "AKIA", secretAccessKey: "secret", region: "us-east-1" };

  it("returns a messageId on success and sends a raw message to the recipient", async () => {
    sendMock.mockResolvedValue({ MessageId: "msg-123", $metadata: { httpStatusCode: 200 } });
    const t = new SESTransport(creds);
    const res = await t.send({ to: "sub@example.com", from: "hello@veloce.app", subject: "S", html: "<p>hi</p>" });

    expect(res.success).toBe(true);
    expect(res.messageId).toBe("msg-123");
    const cmdInput = sendMock.mock.calls[0][0].input;
    expect(cmdInput.Source).toBe("hello@veloce.app");
    expect(cmdInput.Destinations).toEqual(["sub@example.com"]);
    expect(cmdInput.RawMessage.Data).toBeInstanceOf(Uint8Array);
  });

  it("maps a thrown SDK error through mapSesError", async () => {
    const t = new SESTransport(creds);
    // Inject the throw via a plain client stub. A vi.fn() that returns a
    // rejected promise gets flagged by Vitest's promise-settlement tracking as
    // an unhandled rejection even when send() catches it; a plain async throw,
    // awaited and caught in the same microtask, does not.
    (t as any).client = {
      send: async () => {
        throw Object.assign(new Error("rate"), { name: "Throttling", $metadata: { httpStatusCode: 429 } });
      },
    };
    const res = await t.send({ to: "a@b.com", from: "f@g.com", subject: "S", text: "hi" });
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe("RATE_LIMITED");
    expect(res.error?.retryable).toBe(true);
  });

  it("fails fast without calling SES when credentials are missing", async () => {
    const t = new SESTransport({ accessKeyId: "", secretAccessKey: "", region: "us-east-1" });
    const res = await t.send({ to: "a@b.com", from: "f@g.com", subject: "S", text: "hi" });
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe("AUTH_FAILED");
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("reports healthy when GetSendQuota resolves", async () => {
    sendMock.mockResolvedValue({ Max24HourSend: 50000, $metadata: { httpStatusCode: 200 } });
    const t = new SESTransport(creds);
    const h = await t.health();
    expect(h.healthy).toBe(true);
    expect(sendMock.mock.calls[0][0].__cmd).toBe("GetSendQuota");
  });
});

describe("registry integration", () => {
  it("registers 'ses' and resolves it to an SESTransport (the wiring this fix adds)", () => {
    expect(registry.has("ses")).toBe(true);
    expect(registry.list()).toContain("ses");
    const t = registry.resolve("ses", { sesAccessKey: "AKIA", sesSecretKey: "secret", sesRegion: "us-east-1" });
    expect(t).toBeTruthy();
    expect(t?.id).toBe("ses");
  });
});
