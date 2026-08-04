import { DEFAULT_BRANDING, escapeHtml, type Branding } from "./branding";

export type MergeRecipient = {
  id: string;
  email: string;
  country: string | null;
  region: string | null;
  city: string | null;
  unsubscribe_token: string;
  first_name: string | null;
  last_name: string | null;
  date_of_birth: string | null;
  phone_number: string | null;
};

export function formatBirthdayPretty(value: string | null): string {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function renderTemplate(template: string, data: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-z0-9_]+)(?:\s*\|\s*([^}]+))?\s*\}\}/gi, (_full, key: string, fallbackRaw?: string) => {
    const value = data[key.toLowerCase()];
    if (typeof value === "string" && value.length > 0) return value;

    const fallback = typeof fallbackRaw === "string" ? fallbackRaw.trim() : "";
    if (fallback.length > 0) return fallback;

    return "";
  });
}

/**
 * Wrap editor content in the sending shell.
 *
 * `branding` is optional and defaults to the palette this template was
 * hardcoded to, so a caller that does not pass it produces byte-identical
 * output to before. The header said "Newsletter Services" regardless of who was
 * sending - a workspace's own name and logo now go there instead, which is the
 * first place brand_colors and logo_url have ever been read.
 *
 * Styles are inline because email clients strip <style> blocks; the editorCss
 * block is kept for the editor's own output but cannot be relied on.
 */
export function buildHtmlFromEditor(
  editorHtml: string,
  editorCss = "",
  branding: Branding = DEFAULT_BRANDING
) {
  const { primary, secondary, logoUrl, name } = branding;
  const safeName = escapeHtml(name);

  // A logo replaces the wordmark when one is set. width/height are attributes as
  // well as styles because Outlook ignores the style attribute on images.
  const header = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" alt="${safeName}" width="160" style="max-width:160px;height:auto;display:block;margin:0 0 20px;border:0;">`
    : `<p style="color:${primary};font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;margin:0 0 16px;">
        ${safeName}
      </p>`;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  ${editorCss ? `<style>${editorCss}</style>` : ""}
</head>
<body style="background:${secondary};font-family:sans-serif;margin:0;padding:40px 24px;">
  <table style="max-width:640px;margin:0 auto;width:100%;">
    <tr><td>
      ${header}
      <div style="color:#e4e4e7;font-size:15px;line-height:1.7;white-space:normal;">
        ${editorHtml}
      </div>
      <hr style="border:none;border-top:1px solid #27272a;margin:32px 0;">
      <p style="color:#71717a;font-size:12px;line-height:1.5;margin:0;">
        You are receiving this email because you subscribed to ${safeName}.
      </p>
    </td></tr>
  </table>
</body>
</html>`;
}

export function buildWebVersionUrl(baseUrl: string, campaignId: string, subscriberId: string): string {
  return `${baseUrl}/web/${encodeURIComponent(campaignId)}?s=${encodeURIComponent(subscriberId)}`;
}

function maybeCapitalizeLowercaseName(value: string | null): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return "";
  if (trimmed !== trimmed.toLowerCase()) return trimmed;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

export interface MergeData {
  /** Values escaped for interpolation into HTML. */
  html: Record<string, string>;
  /** Raw values, for the text/plain alternative. */
  text: Record<string, string>;
}

/**
 * Build the merge-tag values for one recipient.
 *
 * Two maps, not one: subscriber names are attacker-influenced and must be
 * escaped before they reach HTML, but using those same escaped values in the
 * plain-text part produced literal entities in the inbox - "O&#39;Brien".
 */
export function mergeDataForRecipient(
  sub: MergeRecipient,
  unsubUrl: string,
  webVersionUrl?: string
): MergeData {
  const firstName = maybeCapitalizeLowercaseName(sub.first_name);
  const lastName = maybeCapitalizeLowercaseName(sub.last_name);
  const fullName = [firstName, lastName].filter(Boolean).join(" ");
  const dateOfBirth = sub.date_of_birth ?? "";
  const city = (sub.city ?? "").trim();
  const region = (sub.region ?? "").trim();
  const country = (sub.country ?? "").trim();
  const location = [city, region, country].filter(Boolean).join(", ");

  const raw: Record<string, string> = {
    first_name: firstName,
    last_name: lastName,
    full_name: fullName,
    date_of_birth: dateOfBirth,
    birthday_pretty: formatBirthdayPretty(dateOfBirth),
    phone_number: (sub.phone_number ?? "").trim(),
    city,
    region,
    country,
    location,
    email: sub.email,
  };

  // URLs are constructed by us, never by the subscriber, and escaping them
  // would corrupt the query strings.
  const urls: Record<string, string> = {
    unsubscribe_url: unsubUrl,
    unsubscribe: unsubUrl,
    web_version_url: webVersionUrl ?? "",
  };

  const escaped = Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [key, escapeHtml(value)])
  );

  return {
    html: { ...escaped, ...urls },
    text: { ...raw, ...urls },
  };
}