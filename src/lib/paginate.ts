/**
 * Keyset pagination for reads that must return everything.
 *
 * PostgREST caps a response at `max-rows` and every call site here previously
 * pinned its own `.limit(10000)` on top of that. With 10,300 subscribers in
 * production, both the workspace export and the smart-tags cron were silently
 * dropping ~300 rows: no error, no warning, just a short answer. An export used
 * as a backup or a data-portability response is the worst possible place for
 * that, and raising the constant only moves the cliff.
 *
 * Keyset rather than `.range()` offsets: offset pagination re-scans and, more
 * importantly, shifts under concurrent inserts, so a row can be skipped or
 * duplicated mid-walk. Ordering by a unique id and asking for "the next N after
 * this id" is stable regardless of what else is writing.
 *
 * `hardCap` is a runaway guard, not a page size. It exists so a bug in a caller
 * cannot spin forever; crossing it is reported rather than silently truncating,
 * which is the behaviour this helper exists to remove.
 */

export interface PageResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

export class PaginationCapExceeded extends Error {
  constructor(public readonly cap: number) {
    super(`Refusing to page past ${cap} rows; the caller is probably not converging.`);
    this.name = "PaginationCapExceeded";
  }
}

/**
 * Walk every row a query matches, one page at a time.
 *
 * @param fetchPage called with the last id seen (null on the first page). Must
 *   apply `.gt("id", afterId)`, `.order("id")` and `.limit(pageSize)` itself -
 *   the caller owns the query so this stays usable with any table, any filter
 *   and either client.
 */
export async function fetchAllRows<T extends { id: string }>(
  fetchPage: (afterId: string | null, pageSize: number) => PromiseLike<PageResult<T>>,
  opts: { pageSize?: number; hardCap?: number } = {}
): Promise<T[]> {
  const pageSize = opts.pageSize ?? 1000;
  const hardCap = opts.hardCap ?? 500_000;

  const all: T[] = [];
  let afterId: string | null = null;

  for (;;) {
    const { data, error } = await fetchPage(afterId, pageSize);
    if (error) throw new Error(error.message);

    const rows = data ?? [];
    all.push(...rows);

    // A short page means the end. Only a full page implies there may be more,
    // so the common single-page case costs exactly one round trip.
    if (rows.length < pageSize) return all;
    if (all.length >= hardCap) throw new PaginationCapExceeded(hardCap);

    afterId = rows[rows.length - 1].id;
  }
}
