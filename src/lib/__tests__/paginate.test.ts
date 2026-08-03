import { describe, it, expect, vi } from "vitest";
import { fetchAllRows, PaginationCapExceeded } from "../paginate";

/**
 * The bug this guards against was silent: at 10,300 subscribers a flat
 * `.limit(10000)` returned 10,000 rows and no error, so an export used as a
 * backup was short by 300 people with nothing to indicate it.
 */

/** A fake table of `n` rows with sortable uuid-ish ids. */
function rows(n: number) {
  return Array.from({ length: n }, (_, i) => ({ id: `id-${String(i).padStart(6, "0")}` }));
}

/** Serves `all` through keyset pagination, the way PostgREST would. */
function pager(all: { id: string }[]) {
  return vi.fn(async (afterId: string | null, pageSize: number) => ({
    data: all.filter((r) => (afterId ? r.id > afterId : true)).slice(0, pageSize),
    error: null,
  }));
}

describe("fetchAllRows", () => {
  it("returns every row when the total exceeds one page", async () => {
    const all = rows(10_300);

    const result = await fetchAllRows(pager(all), { pageSize: 1000 });

    // The exact case that was being truncated.
    expect(result).toHaveLength(10_300);
    expect(result.at(-1)?.id).toBe("id-010299");
  });

  it("does not drop or duplicate rows across page boundaries", async () => {
    const result = await fetchAllRows(pager(rows(2500)), { pageSize: 1000 });

    expect(new Set(result.map((r) => r.id)).size).toBe(2500);
  });

  it("costs a single round trip when the result fits in one page", async () => {
    const fetchPage = pager(rows(42));

    await fetchAllRows(fetchPage, { pageSize: 1000 });

    // A short page means the end; asking again would be a wasted request.
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("makes exactly one extra call when the total is an exact multiple of the page size", async () => {
    const fetchPage = pager(rows(2000));

    const result = await fetchAllRows(fetchPage, { pageSize: 1000 });

    // Two full pages cannot be distinguished from "more to come" without asking.
    expect(result).toHaveLength(2000);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it("returns an empty array rather than throwing on an empty table", async () => {
    expect(await fetchAllRows(pager([]), { pageSize: 1000 })).toEqual([]);
  });

  it("surfaces a query error instead of returning a partial result", async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ data: rows(1000), error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "42501 permission denied" } });

    // Half an export is worse than a failed one, because it looks complete.
    await expect(fetchAllRows(fetchPage, { pageSize: 1000 })).rejects.toThrow("42501");
  });

  it("throws rather than looping forever when a caller never converges", async () => {
    // A pager that ignores the cursor: always a full page, never advancing.
    const stuck = vi.fn(async (_afterId: string | null, pageSize: number) => ({
      data: rows(pageSize),
      error: null,
    }));

    await expect(fetchAllRows(stuck, { pageSize: 100, hardCap: 500 })).rejects.toBeInstanceOf(
      PaginationCapExceeded
    );
  });
});
