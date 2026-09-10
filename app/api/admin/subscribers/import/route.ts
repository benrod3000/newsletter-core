import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { getAdminContextFromHeaders } from "@/lib/admin-context";
import { toE164 } from "@/lib/phone";
import type { TablesInsert } from "@/lib/database.types";

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function POST(req: NextRequest) {
  const admin = getAdminContextFromHeaders(req.headers);
  if (!admin) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (admin.role === "viewer") return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  const supabase = getSupabaseClient();

  let clientId = admin.clientId;
  if (!clientId) {
    const { data } = await supabase.from("clients").select("id").eq("slug", "default").maybeSingle();
    clientId = data?.id ?? null;
  }
  if (!clientId) {
    return NextResponse.json({ error: "No workspace found." }, { status: 422 });
  }

  let csvText = "";
  let markConfirmed = false;

  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const formData = await req.formData().catch(() => null);
    if (!formData) return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
    const file = formData.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "No CSV file provided." }, { status: 400 });
    }
    csvText = await (file as File).text();
    markConfirmed = formData.get("confirmed") === "true";
  } else {
    const body = await req.json().catch(() => null);
    if (!body?.csv || typeof body.csv !== "string") {
      return NextResponse.json({ error: "No CSV provided." }, { status: 400 });
    }
    csvText = body.csv;
    markConfirmed = body.confirmed === true;
  }

  const lines = csvText.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) {
    return NextResponse.json(
      { error: "CSV must have a header row and at least one data row." },
      { status: 422 }
    );
  }

  const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, ""));
  const emailIdx = headers.indexOf("email");
  if (emailIdx === -1) {
    return NextResponse.json({ error: "CSV must have an 'email' column." }, { status: 422 });
  }

  // Map CSV columns to subscriber DB columns
  const allowedFields: Record<string, string> = {
    first_name: "first_name",
    last_name: "last_name",
    date_of_birth: "date_of_birth",
    phone_number: "phone_number",
    country: "country",
    region: "region",
    city: "city",
    timezone: "timezone",
    locale: "locale",
    utm_source: "utm_source",
    utm_medium: "utm_medium",
    utm_campaign: "utm_campaign",
  };

  const skipped: string[] = [];
  /**
   * Rows that imported, but with something dropped along the way.
   *
   * Kept apart from `skipped` on purpose: "we did not import this person" and
   * "we imported this person without their phone number" are different outcomes,
   * and collapsing them into one count is how an operator concludes an import
   * went cleanly when part of it did not.
   */
  const warnings: string[] = [];
  const rows: Record<string, unknown>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const email = cols[emailIdx]?.toLowerCase().trim();
    if (!email || !isValidEmail(email)) {
      skipped.push(`Row ${i + 1}: invalid email "${cols[emailIdx] ?? ""}"`);
      continue;
    }

    const row: Record<string, unknown> = {
      email,
      workspace_id: clientId,
      confirmed: markConfirmed,
    };

    for (const [csvField, dbField] of Object.entries(allowedFields)) {
      const idx = headers.indexOf(csvField);
      if (idx !== -1 && cols[idx]?.trim()) {
        row[dbField] = cols[idx].trim();
      }
    }

    // Phone numbers are stored as E.164 only, so a CSV value has to be resolved
    // against the row's own country before it lands. A number that cannot be
    // resolved is dropped rather than stored as typed: an unsendable number that
    // looks valid is worse than an absent one, because it is invisible until a
    // campaign silently reaches fewer people than the count promised.
    if (row.phone_number) {
      const normalized = toE164(row.phone_number, typeof row.country === "string" ? row.country : null);
      if (normalized) {
        row.phone_number = normalized;
      } else {
        warnings.push(
          `Row ${i + 1}: imported without phone number, could not read "${String(row.phone_number)}"`
        );
        delete row.phone_number;
      }
    }

    rows.push(row);
  }

  if (rows.length === 0) {
    return NextResponse.json({ error: "No valid rows found.", skipped }, { status: 422 });
  }

  // Upsert in batches of 100 (update existing, insert new)
  let processed = 0;
  const BATCH = 100;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { data, error } = await supabase
      .from("subscribers")
      // onConflict is "workspace_id,email" because that is the unique key
      // (migration 024). Conflicting on "email" alone matched, or failed
      // against, rows belonging to other workspaces - the same cross-tenant
      // mistake already fixed in /api/subscribe and the SendGrid webhook.
      .upsert(batch as TablesInsert<"subscribers">[], { onConflict: "workspace_id,email", ignoreDuplicates: false })
      .select("id");
    if (error) {
      return NextResponse.json({ error: `Import failed at row ${i + 1}: ${error.message}` }, { status: 500 });
    }
    processed += data?.length ?? 0;
  }

  return NextResponse.json({
    ok: true,
    processed,
    skipped: skipped.length,
    skippedDetails: skipped.slice(0, 20),
    warnings: warnings.length,
    warningDetails: warnings.slice(0, 20),
  });
}
