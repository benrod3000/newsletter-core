/**
 * Shared widget configuration vocabulary.
 *
 * These values are mirrored by a CHECK constraint on widgets.size (migration
 * 052) and by the size classes in the public form renderer. Keeping the list in
 * one module means the API rejects an unknown size with a 400 that names the
 * problem, rather than passing it through to Postgres and surfacing a
 * constraint violation as a 500.
 */
export const WIDGET_SIZES = ["small", "medium", "large"] as const;

export type WidgetSize = (typeof WIDGET_SIZES)[number];

export function isWidgetSize(value: unknown): value is WidgetSize {
  return typeof value === "string" && (WIDGET_SIZES as readonly string[]).includes(value);
}
