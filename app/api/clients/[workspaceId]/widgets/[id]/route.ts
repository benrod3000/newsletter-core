import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import {
  getClientContextFromJWT,
  assertWorkspaceAccess,
  canEditAsClient,
} from "@/lib/client-context";

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/**
 * PATCH /api/clients/[workspaceId]/widgets/[id]
 * Update a widget's configuration (JWT authenticated, requires edit permission)
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; id: string }> }
) {
  const { workspaceId, id } = await params;
  const context = getClientContextFromJWT(req);

  if (!context || !assertWorkspaceAccess(context, workspaceId)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!canEditAsClient(context)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  if (!isUuid(id)) {
    return NextResponse.json({ error: "Invalid widget ID" }, { status: 422 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const supabase = getSupabaseClient();

  // Verify widget exists and belongs to workspace
  const { data: existing, error: fetchError } = await supabase
    .from("widgets")
    .select("id")
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .single();

  if (fetchError || !existing) {
    return NextResponse.json({ error: "Widget not found" }, { status: 404 });
  }

  // Build update object (only include provided fields)
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const allowedFields = [
    "name", "headline", "description", "download_url",
    "button_text", "success_message", "placeholder", "list_id", "is_active",
  ];

  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      updates[field] = typeof body[field] === "string" ? (body[field] as string).trim() : body[field];
    }
  }

  if (Object.keys(updates).length <= 1) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  try {
    const { data, error } = await supabase
      .from("widgets")
      .update(updates)
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .select()
      .single();

    if (error) {
      console.error("Widget update error:", error);
      return NextResponse.json(
        { error: "Failed to update widget" },
        { status: 500 }
      );
    }

    return NextResponse.json({ widget: data }, { status: 200 });
  } catch (error) {
    console.error("Widget update endpoint error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/clients/[workspaceId]/widgets/[id]
 * Delete a widget and its submissions (JWT authenticated, requires edit permission)
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; id: string }> }
) {
  const { workspaceId, id } = await params;
  const context = getClientContextFromJWT(req);

  if (!context || !assertWorkspaceAccess(context, workspaceId)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!canEditAsClient(context)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  if (!isUuid(id)) {
    return NextResponse.json({ error: "Invalid widget ID" }, { status: 422 });
  }

  const supabase = getSupabaseClient();

  // Verify widget exists
  const { data: existing, error: fetchError } = await supabase
    .from("widgets")
    .select("id")
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .single();

  if (fetchError || !existing) {
    return NextResponse.json({ error: "Widget not found" }, { status: 404 });
  }

  const { error: deleteError } = await supabase
    .from("widgets")
    .delete()
    .eq("id", id)
    .eq("workspace_id", workspaceId);

  if (deleteError) {
    console.error("Widget delete error:", deleteError);
    return NextResponse.json(
      { error: "Failed to delete widget" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
