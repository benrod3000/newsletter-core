import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * GET /api/public/forms/[slug]
 * Public endpoint — returns widget configuration for rendering the signup form.
 * No authentication required.
 *
 * Returns: { widget: { headline, description, button_text, placeholder, success_message } }
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const supabase = getSupabaseClient();

  try {
    const { data, error } = await supabase
      .from("widgets")
      .select("id, workspace_id, headline, description, download_url, button_text, success_message, placeholder, is_active, type, fields, styles")
      .eq("slug", slug)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (error) {
      console.error("Public form fetch error:", error);
      return NextResponse.json(
        { error: "Failed to load form" },
        { status: 500, headers: CORS_HEADERS }
      );
    }

    if (!data) {
      return NextResponse.json(
        { error: "Form not found" },
        { status: 404, headers: CORS_HEADERS }
      );
    }

    if (!data.is_active) {
      return NextResponse.json(
        { error: "This form is no longer active" },
        { status: 410, headers: CORS_HEADERS }
      );
    }

    // Don't expose download_url or internal IDs to the client
    const { download_url: _downloadUrl, id: _wid, workspace_id: _wsid, ...safeWidget } = data;

    // Track impression (fire-and-forget)
    if (_wid && _wsid) {
      fetch(`${process.env.SUPABASE_URL}/rest/v1/widget_events`, {
        method: 'POST',
        headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ widget_id: _wid, workspace_id: _wsid, event_type: 'impression', occurred_at: new Date().toISOString() }),
      }).catch(() => {});
    }

    return NextResponse.json(
      { widget: safeWidget },
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (error) {
    console.error("Public form endpoint error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
