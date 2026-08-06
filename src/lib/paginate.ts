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

/**
 * PostgREST's server-side row ceiling (`db-max-rows`), measured against this
 * project: a request for 10,000 rows returns 1,000, with no error and no
 * indication the answer was cut short.
 *
 * That is the actual mechanism behind the truncation this module fixes. The
 * `.limit(10000)` call sites were never the binding constraint - they only made
 * the intent look deliberate. Verify with:
 *
 *   curl "$SUPABASE_URL/rest/v1/subscribers?select=id&limit=10000" -H apikey:...
 */
export const MAX_ROWS = 1000;

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
/**
 * `id` may be a string or a number: uuid primary keys dominate this schema, but
 * subscriber_tags, automation_logs and gdpr_audit_events use bigint. Both order
 * monotonically, which is all the cursor needs.
 */
export async function fetchAllRows<T extends { id: string | number }>(
  fetchPage: (afterId: string | number | null, pageSize: number) => PromiseLike<PageResult<T>>,
  opts: { pageSize?: number; hardCap?: number } = {}
): Promise<T[]> {
  // Clamped, and this is load-bearing rather than tidiness.
  //
  // The walk below ends when a page comes back shorter than requested. PostgREST
  // enforces its own `max-rows` ceiling (1,000 on this project, measured) and
  // silently returns that many whatever `limit` asks for - which is exactly how
  // the original bug worked: `?limit=10000` returned 1,000 rows and no error.
  //
  // So a caller passing pageSize > MAX_ROWS would receive 1,000, read that as a
  // short page, and stop - reintroducing the silent truncation inside the helper
  // written to remove it. Clamping keeps "short page" a truthful end signal.
  const pageSize = Math.min(opts.pageSize ?? MAX_ROWS, MAX_ROWS);
  const hardCap = opts.hardCap ?? 500_000;

  const all: T[] = [];
  let afterId: string | number | null = null;

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
