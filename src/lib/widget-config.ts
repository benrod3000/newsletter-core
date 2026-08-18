/**
 * Shared widget configuration vocabulary.
 *
 * These values are mirrored by a CHECK constraint on widgets.size (migration
 * 052) and by the size classes in the public form renderer. Keeping the list in
 * one module means the API rejects an unknown size with a 400 that names the
 * problem, rather than passing it through to Postgres and surfacing a
 * constraint violation as a 500.
 */
export const WIDGET_SIZES = ["slim", "small", "medium", "large"] as const;

export type WidgetSize = (typeof WIDGET_SIZES)[number];

export function isWidgetSize(value: unknown): value is WidgetSize {
  return typeof value === "string" && (WIDGET_SIZES as readonly string[]).includes(value);
}

/**
 * The widget types the builder offers.
 *
 * Previously this list existed only in the dashboard, and the API accepted any
 * string at all - `type` was written straight through with a `|| "lead_magnet"`
 * fallback. Naming the set here means an unrecognised type is rejected where it
 * can be explained, instead of being stored and quietly rendering as a lead
 * magnet in the public form.
 */
export const WIDGET_TYPES = [
  "lead_magnet",
  "newsletter",
  "event_rsvp",
  "coupon",
  "feedback",
  "sms_list",
] as const;

export type WidgetType = (typeof WIDGET_TYPES)[number];

export function isWidgetType(value: unknown): value is WidgetType {
  return typeof value === "string" && (WIDGET_TYPES as readonly string[]).includes(value);
}

/**
 * Types for which `download_url` is the thing being exchanged for an address.
 *
 * `lead_magnet` puts it behind the email and links to it; `coupon` renders it
 * literally as the code on the success screen. The other four never read the
 * column, which is why requiring it of every type made a feedback form
 * impossible to create: the builder only validated it for lead magnets, so the
 * request passed the client and came back a 400 from the API.
 */
export const TYPES_REQUIRING_DOWNLOAD_URL: readonly WidgetType[] = ["lead_magnet", "coupon"];

export function requiresDownloadUrl(type: unknown): boolean {
  return isWidgetType(type) && TYPES_REQUIRING_DOWNLOAD_URL.includes(type);
}
