import { NextResponse } from "next/server";
import { withWorkspace } from "@/lib/with-workspace";
import { logError } from "@/lib/logger";

const COLUMNS = [
  "email", "first_name", "last_name", "phone_number", "date_of_birth",
  "country", "region", "city", "timezone", "locale",
  "utm_source", "utm_medium", "utm_campaign",
  "consent_email_marketing", "consent_analytics_tracking",
  "status", "created_at",
] as const;

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * GET /api/clients/[workspaceId]/subscribers/export
 * Export subscribers as CSV.
 *
 * Query params:
 * - status: "confirmed" | "pending" (optional - exports all if omitted)
 */
export const GET = withWorkspace(async ({ req, ctx, db }) => {
  const status = new URL(req.url).searchParams.get("status");

  let query = db
    .from("subscribers")
    .select(
      "email, first_name, last_name, phone_number, date_of_birth, country, region, city, timezone, locale, utm_source, utm_medium, utm_campaign, consent_email_marketing, consent_analytics_tracking, confirmed, suppressed, suppressed_reason, created_at"
    )
    .eq("workspace_id", ctx.workspaceId);

  if (status === "confirmed") query = query.eq("confirmed", true);
  else if (status === "pending") query = query.eq("confirmed", false);

  const { data: subscribers, error } = await query.order("created_at", { ascending: false });

  if (error) {
    logError(error, { route: "clients.subscribers.export", workspaceId: ctx.workspaceId });
    return NextResponse.json({ error: "Failed to export subscribers" }, { status: 500 });
  }

  const rows = (subscribers ?? []).map((s) => {
    const statusLabel = s.suppressed ? "suppressed" : s.confirmed ? "confirmed" : "pending";
    return [
      csvEscape(s.email),
      csvEscape(s.first_name),
      csvEscape(s.last_name),
      csvEscape(s.phone_number),
      csvEscape(s.date_of_birth),
      csvEscape(s.country),
      csvEscape(s.region),
      csvEscape(s.city),
      csvEscape(s.timezone),
      csvEscape(s.locale),
      csvEscape(s.utm_source),
      csvEscape(s.utm_medium),
      csvEscape(s.utm_campaign),
      s.consent_email_marketing ? "true" : "false",
      s.consent_analytics_tracking ? "true" : "false",
      statusLabel,
      s.created_at ? new Date(s.created_at).toISOString() : "",
    ].join(",");
  });

  const csv = `${COLUMNS.join(",")}\n${rows.length ? `${rows.join("\n")}\n` : ""}`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename=subscribers-${ctx.workspaceId}.csv`,
    },
  });
});
