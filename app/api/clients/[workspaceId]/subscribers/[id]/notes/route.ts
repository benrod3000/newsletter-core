import { NextRequest, NextResponse } from "next/server";
import { getClientContextFromJWT, assertWorkspaceAccess } from "@/lib/client-context";
import { getSupabaseClient } from "@/lib/supabase";
import { isUuid } from "@/lib/route-params";
import { logError } from "@/lib/logger";

/**
 * Confirm a subscriber belongs to the caller's workspace.
 * subscriber_notes and subscriber_tags are keyed only by subscriber_id, so
 * reading them without this check exposes other workspaces' data.
 */
async function subscriberBelongsToWorkspace(id: string, workspaceId: string): Promise<boolean> {
  const { data } = await getSupabaseClient()
    .from("subscribers")
    .select("id")
    .eq("id", id)
    .eq("client_id", workspaceId)
    .maybeSingle();
  return !!data;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; id: string }> }
) {
  const { workspaceId, id } = await params;
  const ctx = getClientContextFromJWT(req);
  if (!ctx || !assertWorkspaceAccess(ctx, workspaceId))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!isUuid(id)) {
    return NextResponse.json({ error: "Invalid subscriber ID" }, { status: 422 });
  }

  try {
    if (!(await subscriberBelongsToWorkspace(id, workspaceId))) {
      return NextResponse.json({ error: "Subscriber not found" }, { status: 404 });
    }

    const supabase = getSupabaseClient();
    const [notesRes, tagsRes] = await Promise.all([
      supabase
        .from("subscriber_notes")
        .select("*")
        .eq("subscriber_id", id)
        .order("created_at", { ascending: false }),
      supabase.from("subscriber_tags").select("tag").eq("subscriber_id", id),
    ]);

    return NextResponse.json({
      notes: notesRes.data ?? [],
      tags: (tagsRes.data ?? []).map((t) => t.tag),
    });
  } catch (err) {
    logError(err, { route: "clients.subscribers.notes.get", workspaceId, subscriberId: id });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; id: string }> }
) {
  const { workspaceId, id } = await params;
  const ctx = getClientContextFromJWT(req);
  if (!ctx || !assertWorkspaceAccess(ctx, workspaceId))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!isUuid(id)) {
    return NextResponse.json({ error: "Invalid subscriber ID" }, { status: 422 });
  }

  const { note, tag } = await req.json().catch(() => ({ note: null, tag: null }));

  try {
    // Without this, a note or tag could be attached to another workspace's
    // subscriber - and GET filters only on subscriber_id, so the owning
    // workspace would then see content it did not create.
    if (!(await subscriberBelongsToWorkspace(id, workspaceId))) {
      return NextResponse.json({ error: "Subscriber not found" }, { status: 404 });
    }

    const supabase = getSupabaseClient();

    if (typeof note === "string" && note.trim()) {
      const { data, error } = await supabase
        .from("subscriber_notes")
        .insert({ subscriber_id: id, workspace_id: workspaceId, note: note.trim() })
        .select()
        .single();

      if (error) {
        logError(error, { route: "clients.subscribers.notes.post", workspaceId, subscriberId: id });
        return NextResponse.json({ error: "Failed to add note" }, { status: 500 });
      }
      return NextResponse.json({ note: data }, { status: 201 });
    }

    if (typeof tag === "string" && tag.trim()) {
      const { error } = await supabase
        .from("subscriber_tags")
        .insert({ subscriber_id: id, workspace_id: workspaceId, tag: tag.trim().toLowerCase() });

      if (error) {
        logError(error, { route: "clients.subscribers.notes.post", workspaceId, subscriberId: id });
        return NextResponse.json({ error: "Failed to add tag" }, { status: 500 });
      }
      return NextResponse.json({ ok: true }, { status: 201 });
    }

    return NextResponse.json({ error: "note or tag required" }, { status: 400 });
  } catch (err) {
    logError(err, { route: "clients.subscribers.notes.post", workspaceId, subscriberId: id });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
