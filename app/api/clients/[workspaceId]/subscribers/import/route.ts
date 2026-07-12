import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import {
  getClientContextFromJWT,
  assertWorkspaceAccess,
  canEditAsClient,
} from "@/lib/client-context";

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

  if (rows.length > 1000) {
    return NextResponse.json({ error: "Maximum 1000 rows per import" }, { status: 400 });
  }

  const supabase = getSupabaseClient();
  let processed = 0;
  const skipped: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const record: Record<string, string> = {};
    headers.forEach((h, idx) => {
      if (row[idx]) record[h] = row[idx];
    });

    const email = record.email;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      skipped.push(`Row ${i + 2}: invalid or missing email`);
      continue;
    }

    const subscriber: Record<string, unknown> = {
      client_id: workspaceId,
      email,
      confirmed,
    };

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

    for (const [key, header] of mappableFields) {
      if (record[header]) subscriber[key] = record[header];
    }

    try {
      const { error } = await supabase
        .from("subscribers")
        .upsert(subscriber, { onConflict: "email" });

      if (error) {
        skipped.push(`Row ${i + 2}: ${error.message}`);
      } else {
        processed++;
      }
    } catch {
      skipped.push(`Row ${i + 2}: unexpected error`);
    }
  }

  return NextResponse.json({
    processed,
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

function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}
