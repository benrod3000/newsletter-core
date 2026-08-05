import { NextResponse } from "next/server";
import { withWorkspace } from "@/lib/with-workspace";
import { isUuid } from "@/lib/route-params";
import { logError } from "@/lib/logger";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Confirm a subscriber belongs to the caller's workspace.
 *
 * Historically this was load-bearing: subscriber_notes and subscriber_tags were
 * keyed only by subscriber_id, so reading or writing them without this check
 * crossed workspaces. Both tables now carry workspace_id and are covered by a
 * policy, so the scoped client cannot reach another tenant regardless. The check
 * stays because it is what turns a foreign id into an honest 404 rather than an
 * empty result.
 */
async function subscriberBelongsToWorkspace(
  db: SupabaseClient,
  id: string,
  workspaceId: string
): Promise<boolean> {
  const { data } = await db
    .from("subscribers")
    .select("id")
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  return !!data;
}

export const GET = withWorkspace<{ workspaceId: string; id: string }>(
  async ({ ctx, db, params }) => {
    const { id } = params;

    if (!isUuid(id)) {
      return NextResponse.json({ error: "Invalid subscriber ID" }, { status: 422 });
    }

    if (!(await subscriberBelongsToWorkspace(db, id, ctx.workspaceId))) {
      return NextResponse.json({ error: "Subscriber not found" }, { status: 404 });
    }

    const [notesRes, tagsRes] = await Promise.all([
      db.from("subscriber_notes")
        .select("*")
        .eq("subscriber_id", id)
        .order("created_at", { ascending: false }),
      db.from("subscriber_tags").select("tag").eq("subscriber_id", id),
    ]);

    // The table exists as of migration 059. Before that it did not, supabase-js
    // reported the missing relation as { error }, and the `?? []` below swallowed
    // it - so this returned an empty list forever while the UI showed a working
    // notes panel. The error check stays: an empty list and a failed read still
    // look identical from the outside, which is what made it invisible.
    if (notesRes.error) {
      logError(notesRes.error, {
        route: "clients.subscribers.notes.get",
        workspaceId: ctx.workspaceId,
        subscriberId: id,
      });
    }
    if (tagsRes.error) {
      logError(tagsRes.error, {
        route: "clients.subscribers.notes.get",
        workspaceId: ctx.workspaceId,
        subscriberId: id,
      });
    }

    return NextResponse.json({
      notes: notesRes.data ?? [],
      tags: (tagsRes.data ?? []).map((t) => t.tag),
    });
  }
);

export const POST = withWorkspace<{ workspaceId: string; id: string }>(
  async ({ req, ctx, db, params }) => {
    const { id } = params;

    if (!isUuid(id)) {
      return NextResponse.json({ error: "Invalid subscriber ID" }, { status: 422 });
    }

    const { note, tag } = await req.json().catch(() => ({ note: null, tag: null }));

    if (!(await subscriberBelongsToWorkspace(db, id, ctx.workspaceId))) {
      return NextResponse.json({ error: "Subscriber not found" }, { status: 404 });
    }

    if (typeof note === "string" && note.trim()) {
      const { data, error } = await db
        .from("subscriber_notes")
        // created_by records who wrote it. The column is nullable and set to
        // null if that person is later removed, because a note stays useful
        // without its author.
        .insert({
          subscriber_id: id,
          workspace_id: ctx.workspaceId,
          note: note.trim(),
          created_by: ctx.userId,
        })
        .select()
        .single();

      if (error) {
        logError(error, {
          route: "clients.subscribers.notes.post",
          workspaceId: ctx.workspaceId,
          subscriberId: id,
        });
        return NextResponse.json({ error: "Failed to add note" }, { status: 500 });
      }
      return NextResponse.json({ note: data }, { status: 201 });
    }

    if (typeof tag === "string" && tag.trim()) {
      const { error } = await db
        .from("subscriber_tags")
        .insert({ subscriber_id: id, workspace_id: ctx.workspaceId, tag: tag.trim().toLowerCase() });

      if (error) {
        logError(error, {
          route: "clients.subscribers.notes.post",
          workspaceId: ctx.workspaceId,
          subscriberId: id,
        });
        return NextResponse.json({ error: "Failed to add tag" }, { status: 500 });
      }
      return NextResponse.json({ ok: true }, { status: 201 });
    }

    return NextResponse.json({ error: "note or tag required" }, { status: 400 });
  },
  { minRole: "editor" }
);
