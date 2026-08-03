import { NextResponse } from "next/server";
import { withWorkspace } from "@/lib/with-workspace";
import { logError } from "@/lib/logger";
import { fetchAllRows } from "@/lib/paginate";
import { logAudit, extractRequestMeta, AUDIT_ACTIONS } from "@/lib/audit-log";
import type { Tables } from "@/lib/database.types";

const COLUMNS = [
  "email", "first_name", "last_name", "phone_number", "date_of_birth",
  "country", "region", "city", "timezone", "locale",
  "utm_source", "utm_medium", "utm_campaign",
  "consent_email_marketing", "consent_analytics_tracking",
  "status", "created_at",
] as const;

/**
 * Cells that Excel, LibreOffice and Sheets treat as a formula rather than text.
 *
 * A subscriber controls their own first name, so a signup as `=HYPERLINK(...)`
 * or `+cmd|'/c calc'!A0` becomes executable the moment an operator opens the
 * export. Quoting alone does not help: the spreadsheet strips the quotes and
 * evaluates what is inside. Prefixing with a single quote is the standard fix
 * and is invisible in the cell.
 */
const FORMULA_PREFIXES = ["=", "+", "-", "@", "\t", "\r"];

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  let str = String(value);

  if (FORMULA_PREFIXES.some((p) => str.startsWith(p))) {
    str = `'${str}`;
  }

  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
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

  // `id` is selected only to drive keyset pagination; it is not a CSV column.
  // Ordering by id rather than created_at because the walk needs a unique key,
  // and created_at is not unique for bulk-imported rows - 10,300 of these were
  // inserted in a handful of batches and share timestamps.
  type ExportRow = Pick<
    Tables<"subscribers">,
    | "id" | "email" | "first_name" | "last_name" | "phone_number" | "date_of_birth"
    | "country" | "region" | "city" | "timezone" | "locale"
    | "utm_source" | "utm_medium" | "utm_campaign"
    | "consent_email_marketing" | "consent_analytics_tracking"
    | "confirmed" | "suppressed" | "suppressed_reason" | "created_at"
  >;

  let subscribers: ExportRow[];
  try {
    subscribers = await fetchAllRows((afterId, pageSize) => {
      let q = db
        .from("subscribers")
        .select(
          "id, email, first_name, last_name, phone_number, date_of_birth, country, region, city, timezone, locale, utm_source, utm_medium, utm_campaign, consent_email_marketing, consent_analytics_tracking, confirmed, suppressed, suppressed_reason, created_at"
        )
        .eq("workspace_id", ctx.workspaceId)
        .order("id", { ascending: true })
        .limit(pageSize);

      if (status === "confirmed") q = q.eq("confirmed", true);
      else if (status === "pending") q = q.eq("confirmed", false);
      if (afterId) q = q.gt("id", afterId);

      return q;
    });
  } catch (err) {
    logError(err, { route: "clients.subscribers.export", workspaceId: ctx.workspaceId });
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

  // Bulk extraction of every contact's name, phone, date of birth and location
  // is exactly the operation an account owner should be able to see after the
  // fact. Awaited rather than fired and forgotten: an export that cannot be
  // recorded should not quietly succeed.
  const { ip, ua } = extractRequestMeta(req);
  await logAudit({
    workspace_id: ctx.workspaceId,
    user_id: ctx.userId,
    action: AUDIT_ACTIONS.SUBSCRIBER_EXPORTED,
    details: { count: rows.length, status: status ?? "all", format: "csv" },
    ip_address: ip,
    user_agent: ua,
  });

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename=subscribers-${ctx.workspaceId}.csv`,
    },
  });
},
// Matches the workspace JSON export, which already required this. Downloading
// the entire audience with names, phone numbers, dates of birth and location is
// not a read operation in any meaningful sense, and a `viewer` could do it.
{ minRole: "editor" });
