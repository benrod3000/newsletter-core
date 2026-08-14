import { NextResponse } from "next/server";
import { withWorkspace } from "@/lib/with-workspace";
import { logError } from "@/lib/logger";
import { isWidgetSize, WIDGET_SIZES } from "@/lib/widget-config";
import { audit, AUDIT_ACTIONS } from "@/lib/audit-log";

/**
 * GET /api/clients/[workspaceId]/widgets
 * Fetch all widgets for a workspace.
 *
 * Returns: { widgets: [...] }
 */
export const GET = withWorkspace(async ({ ctx, db }) => {
  const { data, error } = await db
    .from("widgets")
    .select("*")
    .eq("workspace_id", ctx.workspaceId)
    .order("created_at", { ascending: false });

  if (error) {
    logError(error, { route: "clients.widgets.list", workspaceId: ctx.workspaceId });
    return NextResponse.json({ error: "Failed to fetch widgets" }, { status: 500 });
  }

  const widgetIds = (data || []).map((w) => w.id);
  const counts: Record<string, number> = {};

  if (widgetIds.length > 0) {
    // NOTE: this pulls one row per submission and counts them in Node. Fine at
    // demo volume, the same shape as the analytics scan the architecture doc
    // calls out, and it will need the same fix - an aggregate in the database
    // rather than a fetch-and-count. Left as-is here to keep this a tenancy
    // change rather than a performance one.
    const { data: countData, error: countError } = await db
      .from("widget_submissions")
      .select("widget_id")
      .in("widget_id", widgetIds);

    if (countError) {
      logError(countError, { route: "clients.widgets.counts", workspaceId: ctx.workspaceId });
    } else {
      for (const row of countData ?? []) {
        counts[row.widget_id] = (counts[row.widget_id] || 0) + 1;
      }
    }
  }

  const widgets = (data || []).map((w) => ({ ...w, submission_count: counts[w.id] || 0 }));

  return NextResponse.json({ widgets }, { status: 200 });
});

/**
 * POST /api/clients/[workspaceId]/widgets
 * Create a new embeddable signup widget. Requires edit permission.
 */
export const POST = withWorkspace(
  async ({ req, ctx, db }) => {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const {
      name, slug, list_id, headline, description, download_url,
      button_text, success_message, placeholder, fields, styles,
      type, size, collect_location, email_subject, email_body, email_heading,
    } = body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }
    if (!slug || typeof slug !== "string" || !slug.trim()) {
      return NextResponse.json({ error: "Slug is required" }, { status: 400 });
    }
    if (!download_url || typeof download_url !== "string" || !download_url.trim()) {
      return NextResponse.json({ error: "Download URL is required" }, { status: 400 });
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      return NextResponse.json(
        { error: "Slug must contain only lowercase letters, numbers, and hyphens" },
        { status: 400 }
      );
    }
    if (size !== undefined && !isWidgetSize(size)) {
      return NextResponse.json(
        { error: `Size must be one of: ${WIDGET_SIZES.join(", ")}` },
        { status: 400 }
      );
    }

    // Slug uniqueness is per workspace, which is the correct scope for a widget.
    const { data: existing } = await db
      .from("widgets")
      .select("id")
      .eq("workspace_id", ctx.workspaceId)
      .eq("slug", slug.trim())
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ error: "A widget with this slug already exists" }, { status: 409 });
    }

    const { data, error } = await db
      .from("widgets")
      .insert({
        workspace_id: ctx.workspaceId,
        name: name.trim(),
        slug: slug.trim(),
        list_id: list_id || null,
        headline: (headline as string)?.trim() || "Get the Free Download",
        description: (description as string)?.trim() || "Enter your email and we'll send you the download link.",
        download_url: download_url.trim(),
        button_text: (button_text as string)?.trim() || "Send Me the Link",
        success_message: (success_message as string)?.trim() || "Check your inbox! The download link is on its way.",
        placeholder: (placeholder as string)?.trim() || "you@example.com",
        fields: fields || { email: { required: true } },
        styles: styles || {
          primary_color: "#f5e642",
          bg_color: "#f5f5f0",
          text_color: "#0a0a0a",
          border_color: "#0a0a0a",
          button_text_color: "#0a0a0a",
        },
        type: type || "lead_magnet",
        size: size || "medium",
        collect_location: collect_location !== false,
        // Null rather than a default: the sender falls back to its built-in copy,
        // so storing wording here would freeze today's text into every new widget.
        email_subject: (email_subject as string)?.trim() || null,
        email_body: (email_body as string)?.trim() || null,
        email_heading: (email_heading as string)?.trim() || null,
      })
      .select()
      .single();

    if (error) {
      logError(error, { route: "clients.widgets.create", workspaceId: ctx.workspaceId });
      return NextResponse.json({ error: "Failed to create widget" }, { status: 500 });
    }

    // A widget is a publicly reachable form that writes into the audience.
    await audit(req, ctx, AUDIT_ACTIONS.WIDGET_CREATED, { widget_id: data.id, name: data.name });

    return NextResponse.json({ widget: data }, { status: 201 });
  },
  { minRole: "editor" }
);
