/**
 * Escape a user-supplied value for use inside a PostgREST filter.
 *
 * PostgREST treats `,` `(` `)` and `.` as filter syntax. An early version of the
 * subscriber search built an `or=(email.ilike.*<search>*,...)` string with only
 * encodeURIComponent applied, which does not encode parentheses at all - so a
 * search term containing `)` could close the or-group and append further
 * top-level filters. The workspace filter is a separate ANDed parameter, so this
 * could not remove tenant scoping, but it could still bend the query.
 *
 * PostgREST allows double-quoting a value, with backslash escapes inside it.
 * Quoting is the correct fix; stripping characters would silently break searches
 * for names like "O'Brien (work)".
 *
 * Shared rather than private to the list route because the export route now
 * accepts the same `search` parameter. Two copies of an injection guard is one
 * copy too many - the second is where the fix does not get applied.
 */
export function quoteFilterValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
