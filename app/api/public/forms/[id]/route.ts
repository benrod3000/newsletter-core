import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { logError } from "@/lib/logger";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * GET /api/public/forms/[id]
 * Public endpoint - returns widget configuration for rendering the signup form.
 * No authentication required.
 *
 * Keyed by widget id, not slug. Slug is unique per workspace
 * (widgets_workspace_id_slug_key), so a slug on its own does not identify a
 * widget: two workspaces both naming a form "newsletter" is not a collision at
 * the database level, and slugs are generated from the widget name, so it is
 * the expected case rather than an unlucky one. Looking up by slug alone meant
 * this endpoint served whichever matching widget was created most recently -
 * one tenant's form configuration rendered on another tenant's embed URL. The
 * id is the primary key and is unambiguous by construction.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // A malformed id would otherwise reach Postgres as an invalid uuid and come
  // back as a 500 rather than "no such form".
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "Form not found" }, { status: 404, headers: CORS_HEADERS });
  }

  const supabase = getSupabaseClient();

  // maybeSingle, not single: single() treats "no rows" as an error, so a
  // mistyped or deleted form returned 500 "Failed to load form" and the 404
  // branch below was unreachable.
  const { data, error } = await supabase
    .from("widgets")
    // One string literal, not a concatenation: supabase-js infers the row type
    // from the literal, and splitting it across a `+` collapses the result to
    // GenericStringError.
    .select("id, workspace_id, headline, description, download_url, button_text, success_message, placeholder, is_active, type, fields, styles, size, collect_location")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    logError(error, { route: "public.forms.get", widgetId: id });
    return NextResponse.json({ error: "Failed to load form" }, { status: 500, headers: CORS_HEADERS });
  }

  if (!data) {
    return NextResponse.json({ error: "Form not found" }, { status: 404, headers: CORS_HEADERS });
  }

  if (!data.is_active) {
    return NextResponse.json(
      { error: "This form is no longer active" },
      { status: 410, headers: CORS_HEADERS }
    );
  }

  // download_url is withheld here on purpose - it is what the email address is
  // being exchanged for, so it must not be readable before signing up. The
  // submit endpoint returns it instead, once a submission succeeds.
  const { download_url: _downloadUrl, workspace_id: workspaceId, ...safeWidget } = data;

  // Awaited rather than fired and forgotten. The previous floating fetch could
  // be cut short when the serverless function returned, so impressions recorded
  // unreliably, and its .catch(() => {}) hid every failure including auth ones.
  const { error: eventError } = await supabase.from("widget_events").insert({
    widget_id: data.id,
    workspace_id: workspaceId,
    event_type: "impression",
    occurred_at: new Date().toISOString(),
  });

  if (eventError) {
    // Analytics must never take the form down, but it should not vanish either.
    logError(eventError, { route: "public.forms.get.impression", widgetId: id });
  }

  return NextResponse.json({ widget: safeWidget }, { status: 200, headers: CORS_HEADERS });
}
