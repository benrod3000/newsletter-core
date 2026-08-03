import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import {
  getClientContextFromJWT,
  assertWorkspaceAccess,
  canEditAsClient,
} from "@/lib/client-context";
import type { TablesInsert } from "@/lib/database.types";

/**
 * Rows accepted in a single request.
 *
 * This is a payload-size limit, not a throughput one. The CSV arrives as a JSON
 * string, and Vercel rejects bodies over roughly 4.5 MB at the edge with
 * FUNCTION_PAYLOAD_TOO_LARGE - measured, 4 MB passes and 4.5 MB does not - so
 * the request never reaches this function. A 50,000-contact file is around that
 * size, which is why the answer to "1,000 is too low" is not simply a bigger
 * number here: raising it alone would swap a clear error for an opaque 413.
 *
 * 5,000 rows is roughly 0.5-1 MB of CSV, comfortably clear of the ceiling, and
 * the dashboard splits anything larger into consecutive requests of this size.
 */
const MAX_ROWS_PER_REQUEST = 5000;

/**
 * Rows per upsert statement. 5,000 rows is 10 round trips at this size rather
 * than 50, and Postgres handles a 500-row ON CONFLICT comfortably.
 */
const BATCH = 500;

/**
 * The default function timeout is not enough for a full-size chunk once every
 * row has been geocoded into place, so ask for headroom explicitly.
 */
export const maxDuration = 60;

/**
 * POST /api/clients/[workspaceId]/subscribers/import
 * Import subscribers from CSV. JWT authenticated, requires edit permission.
 *
 * Body: { csv: string, confirmed?: boolean }
 *
 * Parses CSV with header row, maps columns, upserts by email.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  const context = getClientContextFromJWT(req);

  if (!context || !assertWorkspaceAccess(context, workspaceId)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!canEditAsClient(context)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const body = await req.json();
  const { csv, confirmed = false } = body;

  if (!csv || typeof csv !== "string") {
    return NextResponse.json({ error: "CSV string required" }, { status: 400 });
  }

  const lines = csv.trim().split("\n");
  if (lines.length < 2) {
    return NextResponse.json({ error: "CSV must have a header row and at least one data row" }, { status: 400 });
  }

  const headers = parseCSVLine(lines[0]).map(normalizeHeader);
  const rows = lines.slice(1).map(parseCSVLine);

  if (rows.length > MAX_ROWS_PER_REQUEST) {
    return NextResponse.json(
      {
        error:
          `Maximum ${MAX_ROWS_PER_REQUEST.toLocaleString()} rows per request. ` +
          `Larger files are uploaded in chunks by the dashboard.`,
      },
      { status: 400 }
    );
  }

  const supabase = getSupabaseClient();
  const skipped: string[] = [];

  const mappableFields: [string, string][] = [
    ["first_name", "first_name"],
    ["last_name", "last_name"],
    ["phone_number", "phone_number"],
    ["date_of_birth", "date_of_birth"],
    ["country", "country"],
    ["region", "region"],
    ["city", "city"],
    ["timezone", "timezone"],
    ["locale", "locale"],
    ["utm_source", "utm_source"],
    ["utm_medium", "utm_medium"],
    ["utm_campaign", "utm_campaign"],
  ];

  // Keyed by email so a CSV containing the same address twice collapses to one
  // row. Without this, a single upsert statement hitting the same conflict
  // target twice fails the whole batch with 21000 "ON CONFLICT DO UPDATE
  // command cannot affect row a second time", which real exports trigger often.
  const byEmail = new Map<string, Record<string, unknown>>();
  let duplicates = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const record: Record<string, string> = {};
    headers.forEach((h, idx) => {
      if (row[idx]) record[h] = row[idx];
    });

    // Lowercased because the uniqueness key is (workspace_id, email); mixed
    // case in the source file would otherwise create two rows for one person.
    const email = record.email?.toLowerCase().trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      skipped.push(`Row ${i + 2}: invalid or missing email`);
      continue;
    }

    const subscriber: Record<string, unknown> = {
      workspace_id: workspaceId,
      email,
      confirmed,
    };

    for (const [key, header] of mappableFields) {
      if (!record[header]) continue;

      // date_of_birth is the only non-text column here, so it is the only value
      // Postgres can reject. That matters now the upsert is batched and fails
      // loudly: one "N/A" or "01/15/1990" in a spreadsheet would abort every row
      // in its batch with a 500, after earlier batches had already committed. Drop the unparseable value, keep the subscriber, say so.
      if (key === "date_of_birth" && !isIsoDate(record[header])) {
        skipped.push(`Row ${i + 2}: ignored date_of_birth "${record[header]}" (expected YYYY-MM-DD)`);
        continue;
      }

      subscriber[key] = record[header];
    }

    if (byEmail.has(email)) duplicates++;
    byEmail.set(email, subscriber);
  }

  const toUpsert = [...byEmail.values()];

  if (toUpsert.length === 0) {
    return NextResponse.json(
      {
        error: "No valid rows found.",
        skipped: skipped.length,
        skippedDetails: skipped.slice(0, 20),
      },
      { status: 422 }
    );
  }

  // Batched rather than one round trip per row. The previous version awaited a
  // separate Supabase call for every line, so a full file meant one sequential
  // request per contact - slow enough to risk the function timeout by itself.
  let processed = 0;

  for (let i = 0; i < toUpsert.length; i += BATCH) {
    const batch = toUpsert.slice(i, i + BATCH);
    const { data, error } = await supabase
      .from("subscribers")
      // Rows are built field by field from the CSV header allowlist, which is
      // what keeps the keys valid; that mapping is what loses the static type.
      .upsert(batch as TablesInsert<"subscribers">[], { onConflict: "workspace_id,email" })
      .select("id");

    // Fail loudly. This previously collected per-row errors into `skipped` and
    // still returned 200, so a total failure was indistinguishable from a
    // successful import that happened to process nothing.
    if (error) {
      return NextResponse.json(
        { error: `Import failed: ${error.message}`, processed },
        { status: 500 }
      );
    }

    processed += data?.length ?? 0;
  }

  return NextResponse.json({
    processed,
    duplicates,
    skipped: skipped.length,
    skippedDetails: skipped.slice(0, 20),
  });
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        result.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * Strict YYYY-MM-DD. Deliberately not `new Date(v)`, which accepts almost
 * anything and would happily turn "1/2/3" into a date Postgres then stores as
 * something nobody typed.
 */
function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}
