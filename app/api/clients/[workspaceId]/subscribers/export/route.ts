import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import {
  getClientContextFromJWT,
  assertWorkspaceAccess,
} from "@/lib/client-context";

/**
 * GET /api/clients/[workspaceId]/subscribers/export
 * Export subscribers as CSV. JWT authenticated.
 *
 * Query params:
 * - status: "confirmed" | "pending" (optional — exports all if omitted)
 *
 * Returns: CSV file download with headers
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  const context = getClientContextFromJWT(req);

  if (!context || !assertWorkspaceAccess(context, workspaceId)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const status = url.searchParams.get("status");

  const supabase = getSupabaseClient();

  try {
    let query = supabase
      .from("subscribers")
      .select(
        "email, first_name, last_name, phone_number, date_of_birth, country, region, city, timezone, locale, utm_source, utm_medium, utm_campaign, consent_email_marketing, consent_analytics_tracking, confirmed, suppressed, suppressed_reason, created_at"
      )
      .eq("client_id", workspaceId);

    if (status === "confirmed") {
      query = query.eq("confirmed", true);
    } else if (status === "pending") {
      query = query.eq("confirmed", false);
    }

    const { data: subscribers, error } = await query.order("created_at", {
      ascending: false,
    });

    if (error) {
      console.error("Subscriber export error:", error);
      return NextResponse.json(
        { error: "Failed to export subscribers" },
        { status: 500 }
      );
    }

    if (!subscribers || subscribers.length === 0) {
      const headers = "email,first_name,last_name,phone_number,date_of_birth,country,region,city,timezone,locale,utm_source,utm_medium,utm_campaign,consent_email_marketing,consent_analytics_tracking,status,created_at\n";
      return new NextResponse(headers, {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename=subscribers-${workspaceId}.csv`,
        },
      });
    }

    // Build CSV
    const headerColumns = [
      "email", "first_name", "last_name", "phone_number", "date_of_birth",
      "country", "region", "city", "timezone", "locale",
      "utm_source", "utm_medium", "utm_campaign",
      "consent_email_marketing", "consent_analytics_tracking",
      "status", "created_at",
    ];

    const csvRows = subscribers.map((s) => {
      const statusLabel = s.suppressed
        ? "suppressed"
        : s.confirmed
          ? "confirmed"
          : "pending";
      const row = [
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
      ];
      return row.join(",");
    });

    const csv = headerColumns.join(",") + "\n" + csvRows.join("\n") + "\n";

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename=subscribers-${workspaceId}.csv`,
      },
    });
  } catch (error) {
    console.error("Subscriber export endpoint error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
