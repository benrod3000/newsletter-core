import type { Json } from "./database.types";
import { jsonObject } from "./json";

/**
 * Workspace branding, resolved and safe to interpolate into HTML.
 *
 * `clients.brand_colors` is unvalidated jsonb - nothing has ever constrained
 * what goes in it, because until now nothing read it back out. Both it and
 * `logo_url` were write-only: stored, returned by the branding endpoint,
 * included in the workspace export, and rendered nowhere. A user could set a
 * colour and a logo and correctly observe that neither did anything.
 *
 * Now that they reach rendered email and public pages, the values have to be
 * treated as untrusted input rather than configuration. A colour goes into a
 * `style` attribute, so `#fff" onload="` would break out of it; a logo URL goes
 * into `src`, so `javascript:` is a live vector on the public pages. Everything
 * here validates and falls back rather than trusting the column.
 */

export interface Branding {
  primary: string;
  secondary: string;
  logoUrl: string | null;
  name: string;
}

/**
 * The palette the product shipped with, used wherever a workspace has set
 * nothing. Matches the existing hardcoded email template so unbranded sends look
 * exactly as they did before.
 */
export const DEFAULT_BRANDING: Branding = {
  primary: "#fbbf24",
  secondary: "#0d0d0d",
  logoUrl: null,
  name: "Newsletter",
};

/** Strict 3- or 6-digit hex. Anything else cannot reach a style attribute. */
const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function safeColor(value: unknown, fallback: string): string {
  return typeof value === "string" && HEX.test(value.trim()) ? value.trim() : fallback;
}

/**
 * Black or white, whichever is readable on the given background.
 *
 * A button hardcoded to black text is fine on the default amber and illegible on a
 * dark brand colour - and email has no way to recover from that, since the
 * recipient cannot restyle it. Uses the WCAG relative-luminance threshold, which is
 * the same rule the widget builder's contrast badge applies.
 */
export function readableTextOn(background: string): "#000000" | "#ffffff" {
  const hex = safeColor(background, DEFAULT_BRANDING.primary).slice(1);
  const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;

  const channel = (pair: string) => {
    const c = parseInt(pair, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };

  const luminance =
    0.2126 * channel(full.slice(0, 2)) +
    0.7152 * channel(full.slice(2, 4)) +
    0.0722 * channel(full.slice(4, 6));

  // Contrast against white vs black; 0.179 is where the two ratios cross.
  return luminance > 0.179 ? "#000000" : "#ffffff";
}

/**
 * An https URL, or null.
 *
 * http is rejected alongside javascript: and data: - not on injection grounds
 * but because a logo loaded over http on an https page is blocked as mixed
 * content, which renders as a broken image rather than an insecure one.
 */
export function safeLogoUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** HTML-escape a value destined for text content or an attribute. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Resolve a `clients` row into branding safe to render.
 *
 * Takes the columns rather than the whole row so callers only have to select
 * what they use, and so this cannot accidentally be handed credential columns.
 */
export function resolveBranding(client: {
  brand_colors?: Json | null;
  logo_url?: string | null;
  sender_name?: string | null;
  name?: string | null;
} | null | undefined): Branding {
  const colors = jsonObject(client?.brand_colors ?? null);

  return {
    primary: safeColor(colors?.primary, DEFAULT_BRANDING.primary),
    secondary: safeColor(colors?.secondary, DEFAULT_BRANDING.secondary),
    logoUrl: safeLogoUrl(client?.logo_url),
    // sender_name is what recipients already see in the From header, so it is
    // the name they will recognise in the body. Falls back to the workspace
    // name, then to a generic label.
    name: (client?.sender_name || client?.name || DEFAULT_BRANDING.name).slice(0, 120),
  };
}

/** The columns resolveBranding needs, for `.select()`. */
export const BRANDING_COLUMNS = "brand_colors, logo_url, sender_name, name";
