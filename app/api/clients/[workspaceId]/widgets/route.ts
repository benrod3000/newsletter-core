import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import {
  getClientContextFromJWT,
  assertWorkspaceAccess,
  canEditAsClient,
} from "@/lib/client-context";

/**
 * GET /api/clients/[workspaceId]/widgets
 * Fetch all widgets for a workspace (JWT authenticated)
 *
 * Returns: { widgets: [...] }
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

  const supabase = getSupabaseClient();

  try {
    // Fetch widgets with submission counts
    const { data, error } = await supabase
      .from("widgets")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Widgets fetch error:", error);
      return NextResponse.json(
        { error: "Failed to fetch widgets" },
        { status: 500 }
      );
    }

    // Get submission counts for each widget
    const widgetIds = (data || []).map((w) => w.id);
    let counts: Record<string, number> = {};

    if (widgetIds.length > 0) {
      const { data: countData, error: countError } = await supabase
        .from("widget_submissions")
        .select("widget_id")
        .in("widget_id", widgetIds);

      if (!countError && countData) {
        for (const row of countData) {
          counts[row.widget_id] = (counts[row.widget_id] || 0) + 1;
        }
      }
    }

    const widgets = (data || []).map((w) => ({
      ...w,
      submission_count: counts[w.id] || 0,
    }));

    return NextResponse.json({ widgets }, { status: 200 });
  } catch (error) {
    console.error("Widgets endpoint error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/clients/[workspaceId]/widgets
 * Create a new embeddable signup widget (JWT authenticated, requires edit permission)
 *
 * Body: {
 *   name: string;
 *   slug: string;
 *   list_id: string;
 *   headline?: string;
 *   description?: string;
 *   download_url: string;
 *   button_text?: string;
 *   success_message?: string;
 *   placeholder?: string;
 * }
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
    return NextResponse.json(
      { error: "Insufficient permissions" },
      { status: 403 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { name, slug, list_id, headline, description, download_url, button_text, success_message, placeholder } = body;

  // Validate required fields
  if (!name || typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }
  if (!slug || typeof slug !== "string" || !slug.trim()) {
    return NextResponse.json({ error: "Slug is required" }, { status: 400 });
  }
  if (!download_url || typeof download_url !== "string" || !download_url.trim()) {
    return NextResponse.json({ error: "Download URL is required" }, { status: 400 });
  }

  // Validate slug format (alphanumeric + hyphens only)
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug as string)) {
    return NextResponse.json(
      { error: "Slug must contain only lowercase letters, numbers, and hyphens" },
      { status: 400 }
    );
  }

  const supabase = getSupabaseClient();

  // Check slug uniqueness within workspace
  const { data: existing } = await supabase
    .from("widgets")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("slug", (slug as string).trim())
    .maybeSingle();

  if (existing) {
    return NextResponse.json(
      { error: "A widget with this slug already exists" },
      { status: 409 }
    );
  }

  try {
    const { data, error } = await supabase
      .from("widgets")
      .insert({
        workspace_id: workspaceId,
        name: (name as string).trim(),
        slug: (slug as string).trim(),
        list_id: list_id || null,
        headline: (headline as string)?.trim() || "Get the Free Download",
        description: (description as string)?.trim() || "Enter your email and we'll send you the download link.",
        download_url: (download_url as string).trim(),
        button_text: (button_text as string)?.trim() || "Send Me the Link",
        success_message: (success_message as string)?.trim() || "Check your inbox! The download link is on its way.",
        placeholder: (placeholder as string)?.trim() || "you@example.com",
      })
      .select()
      .single();

    if (error) {
      console.error("Widget create error:", error);
      return NextResponse.json(
        { error: "Failed to create widget" },
        { status: 500 }
      );
    }

    return NextResponse.json({ widget: data }, { status: 201 });
  } catch (error) {
    console.error("Widget create endpoint error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
