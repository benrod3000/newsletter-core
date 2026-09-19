import { describe, it, expect } from "vitest";
import {
  checkUpload,
  buildStoragePath,
  sanitizeFilename,
  MAX_FILE_BYTES,
  MAX_WORKSPACE_BYTES,
  ALLOWED_MIME,
} from "../assets";

const MB = 1024 * 1024;

/**
 * The content library's limits.
 *
 * These are not tidiness rules. A giveaway is a fan-out download, and this
 * project's egress quota is shared with the database that serves the app, so an
 * upload that is too large or a quota that is not actually enforced is an
 * availability problem rather than a storage one. Each case below is a way that
 * has gone wrong in file-upload features before.
 */
describe("checkUpload", () => {
  const ok = { mime: "application/pdf", bytes: 1 * MB, usedBytes: 0 };

  it("accepts an allowed type and reports the extension to store it under", () => {
    expect(checkUpload(ok)).toEqual({ ok: true, extension: "pdf" });
  });

  it("refuses SVG, which can carry script", () => {
    const got = checkUpload({ ...ok, mime: "image/svg+xml" });
    expect(got.ok).toBe(false);
    if (!got.ok) expect(got.code).toBe("mime");
  });

  it("refuses HTML, for the same reason", () => {
    const got = checkUpload({ ...ok, mime: "text/html" });
    expect(got.ok).toBe(false);
    if (!got.ok) expect(got.code).toBe("mime");
  });

  it("refuses an unknown type rather than defaulting it", () => {
    const got = checkUpload({ ...ok, mime: "application/x-msdownload" });
    expect(got.ok).toBe(false);
    if (!got.ok) expect(got.code).toBe("mime");
  });

  it("refuses an empty file", () => {
    // A zero-byte upload is a failed client read, not an intention. Storing it
    // would promise a download that delivers nothing.
    const got = checkUpload({ ...ok, bytes: 0 });
    expect(got.ok).toBe(false);
    if (!got.ok) expect(got.code).toBe("empty");
  });

  it("refuses a file over the per-file cap", () => {
    const got = checkUpload({ ...ok, bytes: MAX_FILE_BYTES + 1 });
    expect(got.ok).toBe(false);
    if (!got.ok) expect(got.code).toBe("file_too_large");
  });

  it("accepts a file exactly at the cap", () => {
    // Boundaries are where off-by-one rejections annoy people for no reason.
    expect(checkUpload({ ...ok, bytes: MAX_FILE_BYTES }).ok).toBe(true);
  });

  it("counts the incoming file against the quota, not just what is already stored", () => {
    // The bug this pins: testing `used > cap` lets any single upload cross the
    // line and only refuses the *next* one, which turns a 100 MB cap into a
    // 110 MB cap. The incoming bytes have to be part of the sum.
    const used = MAX_WORKSPACE_BYTES - 1 * MB;
    const got = checkUpload({ mime: "application/pdf", bytes: 2 * MB, usedBytes: used });
    expect(got.ok).toBe(false);
    if (!got.ok) expect(got.code).toBe("quota");
  });

  it("allows an upload that exactly fills the remaining quota", () => {
    const used = MAX_WORKSPACE_BYTES - 2 * MB;
    expect(checkUpload({ mime: "application/pdf", bytes: 2 * MB, usedBytes: used }).ok).toBe(true);
  });

  it("says how much room is left when it refuses on quota", () => {
    const got = checkUpload({
      mime: "application/pdf",
      bytes: MAX_FILE_BYTES,
      usedBytes: MAX_WORKSPACE_BYTES - 1 * MB,
    });
    expect(got.ok).toBe(false);
    if (!got.ok) expect(got.message).toContain("1 MB remaining");
  });

  it("checks the type before the size, so an .exe is refused as a type", () => {
    // Otherwise a huge disallowed file reports "too large", the operator
    // compresses it, and only then learns it was never going to be accepted.
    const got = checkUpload({ mime: "text/html", bytes: MAX_FILE_BYTES + 1, usedBytes: 0 });
    expect(got.ok).toBe(false);
    if (!got.ok) expect(got.code).toBe("mime");
  });
});

describe("buildStoragePath", () => {
  it("scopes the object to the workspace and names it by uuid", () => {
    expect(buildStoragePath("ws-1", "pdf", "abc-123")).toBe("ws-1/abc-123.pdf");
  });

  it("never derives the name from the uploaded filename", () => {
    // The bucket is public so downloads stay CDN-cacheable, which makes the path
    // the only thing between a file and the open internet. `resume.pdf` would be
    // guessable on the first try.
    const path = buildStoragePath("ws-1", "pdf", "abc-123");
    expect(path).not.toContain("resume");
  });
});

describe("sanitizeFilename", () => {
  it("keeps a readable name readable", () => {
    expect(sanitizeFilename("Q3 Report (final).pdf")).toBe("Q3 Report (final).pdf");
  });

  it("drops any directory component", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("C:\\Users\\ben\\report.pdf")).toBe("report.pdf");
  });

  it("strips control characters, which can hide a real extension in a UI", () => {
    expect(sanitizeFilename("invoice\u202e\u0000.pdf")).not.toContain("\u0000");
  });

  it("falls back rather than returning an empty name", () => {
    expect(sanitizeFilename("")).toBe("file");
    expect(sanitizeFilename("   ")).toBe("file");
  });

  it("caps the length", () => {
    expect(sanitizeFilename("a".repeat(400)).length).toBeLessThanOrEqual(120);
  });
});

describe("ALLOWED_MIME", () => {
  it("maps every allowed type to an extension", () => {
    for (const [mime, ext] of Object.entries(ALLOWED_MIME)) {
      expect(ext, `${mime} has no extension`).toMatch(/^[a-z0-9]+$/);
    }
  });

  it("excludes the executable-content types", () => {
    expect(ALLOWED_MIME["image/svg+xml"]).toBeUndefined();
    expect(ALLOWED_MIME["text/html"]).toBeUndefined();
    expect(ALLOWED_MIME["application/javascript"]).toBeUndefined();
  });
});
