import type { Json } from "./database.types";

/**
 * Read one key out of a jsonb column.
 *
 * Generated types give jsonb columns the full `Json` union, which includes
 * strings, numbers and arrays, so `row.metadata?.city` does not compile: most
 * members of that union have no properties at all. That is the type system
 * telling the truth - `campaign_events.metadata` really can hold a bare string,
 * because nothing constrains what writers put there.
 *
 * These helpers narrow once, in one place, instead of scattering casts at every
 * read site. A cast would silence the checker and keep the bug; this returns
 * undefined for the shapes that genuinely have no such field.
 */
export function jsonObject(value: Json | null | undefined): Record<string, Json | undefined> | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, Json | undefined>;
}

/** A jsonb field read as a string, or undefined when absent or not a string. */
export function jsonString(value: Json | null | undefined, key: string): string | undefined {
  const obj = jsonObject(value);
  const field = obj?.[key];
  return typeof field === "string" ? field : undefined;
}
