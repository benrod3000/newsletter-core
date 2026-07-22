/**
 * Shared validation for values taken from the request path or query string.
 *
 * Most tables in this schema use uuid primary keys, and route handlers
 * interpolate those ids into PostgREST filters. Validating the format before
 * the value reaches a query string is what keeps that interpolation safe.
 *
 * This predicate was previously copy-pasted into seven route files.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
