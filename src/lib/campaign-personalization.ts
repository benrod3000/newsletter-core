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

export function buildHtmlFromEditor(editorHtml: string, editorCss = "") {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  ${editorCss ? `<style>${editorCss}</style>` : ""}
</head>
<body style="background:#0d0d0d;font-family:sans-serif;margin:0;padding:40px 24px;">
  <table style="max-width:640px;margin:0 auto;width:100%;">
    <tr><td>
      <p style="color:#fbbf24;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;margin:0 0 16px;">
        Newsletter Services
      </p>
      <div style="color:#e4e4e7;font-size:15px;line-height:1.7;white-space:normal;">
        ${editorHtml}
      </div>
      <hr style="border:none;border-top:1px solid #27272a;margin:32px 0;">
      <p style="color:#71717a;font-size:12px;line-height:1.5;margin:0;">
        You are receiving this email because you subscribed to the newsletter.
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

export function mergeDataForRecipient(
  sub: MergeRecipient,
  unsubUrl: string,
  webVersionUrl?: string
): Record<string, string> {
  const firstName = maybeCapitalizeLowercaseName(sub.first_name);
  const lastName = maybeCapitalizeLowercaseName(sub.last_name);
  const fullName = [firstName, lastName].filter(Boolean).join(" ");
  const dateOfBirth = sub.date_of_birth ?? "";
  const location = [sub.city, sub.region, sub.country].filter(Boolean).join(", ");

  return {
    first_name: firstName,
    last_name: lastName,
    full_name: fullName,
    date_of_birth: dateOfBirth,
    birthday_pretty: formatBirthdayPretty(dateOfBirth),
    phone_number: (sub.phone_number ?? "").trim(),
    city: (sub.city ?? "").trim(),
    region: (sub.region ?? "").trim(),
    country: (sub.country ?? "").trim(),
    location,
    email: sub.email,
    unsubscribe_url: unsubUrl,
    web_version_url: webVersionUrl ?? "",
  };
}