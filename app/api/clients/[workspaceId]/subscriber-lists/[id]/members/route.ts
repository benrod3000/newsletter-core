import { NextResponse } from "next/server";
import { z } from "zod";
import { withWorkspace } from "@/lib/with-workspace";
import { isUuid } from "@/lib/route-params";
import { logError } from "@/lib/logger";
import { audit, AUDIT_ACTIONS } from "@/lib/audit-log";

const addMembersSchema = z.object({
  subscriber_ids: z.array(z.string().uuid()).min(1).max(1000),
});

/**
 * POST /api/clients/[workspaceId]/subscriber-lists/[id]/members
 * Add subscribers to a list. Requires edit permission.
 */
export const POST = withWorkspace<{ workspaceId: string; id: string }>(
  async ({ req, ctx, db, params }) => {
    const listId = params.id;

    if (!isUuid(listId)) {
      return NextResponse.json({ error: "Invalid list ID" }, { status: 422 });
    }

    const parsed = addMembersSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "subscriber_ids must be an array of 1-1000 UUIDs" },
        { status: 400 }
      );
    }

    const { data: list, error: listError } = await db
      .from("subscriber_lists")
      .select("id")
      .eq("id", listId)
      .eq("workspace_id", ctx.workspaceId)
      .maybeSingle();

    if (listError) {
      logError(listError, { route: "clients.lists.members.add", workspaceId: ctx.workspaceId, listId });
      return NextResponse.json({ error: "Failed to add members" }, { status: 500 });
    }
    if (!list) {
      return NextResponse.json({ error: "List not found" }, { status: 404 });
    }

    // The list was checked but the subscribers never were, so any subscriber id
    // from any workspace could be written into this workspace's list. The send
    // path filters by workspace when resolving a list audience, so it would not
    // have delivered mail to them - but the membership rows were real, the counts
    // were wrong, and a 200 confirmed the existence of an arbitrary subscriber id.
    const { data: owned, error: verifyError } = await db
      .from("subscribers")
      .select("id")
      .eq("workspace_id", ctx.workspaceId)
      .in("id", parsed.data.subscriber_ids);

    if (verifyError) {
      logError(verifyError, { route: "clients.lists.members.add", workspaceId: ctx.workspaceId, listId });
      return NextResponse.json({ error: "Failed to add members" }, { status: 500 });
    }

    const validIds = (owned ?? []).map((s) => s.id);
    if (validIds.length === 0) {
      return NextResponse.json(
        { error: "No valid subscribers found in this workspace" },
        { status: 400 }
      );
    }

    const rows = validIds.map((subscriberId) => ({
      subscriber_id: subscriberId,
      list_id: listId,
      // Required since migration 048. Without it this insert now fails outright.
      workspace_id: ctx.workspaceId,
    }));

    const batchSize = 100;
    for (let i = 0; i < rows.length; i += batchSize) {
      const { error } = await db
        .from("subscriber_list_memberships")
        .upsert(rows.slice(i, i + batchSize), { ignoreDuplicates: true });

      if (error) {
        // Every batch response used to be discarded, so a total failure returned
        // { ok: true } with a count of everything requested.
        logError(error, {
          route: "clients.lists.members.add",
          workspaceId: ctx.workspaceId,
          listId,
          batchStart: i,
        });
        return NextResponse.json({ error: "Failed to add members" }, { status: 500 });
      }
    }

    // Reports what was actually added, not what was asked for.
    return NextResponse.json({ ok: true, added: validIds.length }, { status: 200 });
  },
  { minRole: "editor" }
);

/**
 * GET /api/clients/[workspaceId]/subscriber-lists/[id]/members
 *
 * Who is in this list, and where each of them came from.
 *
 * There was no way to read this. The Lists page could create a list and delete
 * it, and nothing in between - so the only way to find out who was in one was
 * to filter Contacts and infer. A list you cannot inspect is hard to trust and
 * easy to mail by accident.
 *
 * `consent_source` is the "where they came from" column: signups through a
 * capture form record `widget:<slug>`, so it distinguishes a form signup from
 * an import without joining anything.
 */
export const GET = withWorkspace<{ workspaceId: string; id: string }>(
  async ({ req, ctx, db, params }) => {
    const listId = params.id;

    if (!isUuid(listId)) {
      return NextResponse.json({ error: "Invalid list ID" }, { status: 422 });
    }

    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 200);
    const offset = parseInt(url.searchParams.get("offset") || "0");

    const { data: list, error: listError } = await db
      .from("subscriber_lists")
      .select("id, name, description, opt_in_type, created_at")
      .eq("id", listId)
      .eq("workspace_id", ctx.workspaceId)
      .maybeSingle();

    if (listError) {
      logError(listError, { route: "clients.subscriber-lists.members.get", workspaceId: ctx.workspaceId, listId });
      return NextResponse.json({ error: "Failed to load list" }, { status: 500 });
    }
    if (!list) return NextResponse.json({ error: "List not found" }, { status: 404 });

    // Embedded rather than two round trips. The FK from memberships to
    // subscribers lets PostgREST return the subscriber inline, and the count is
    // the list's real size rather than the size of this page.
    const { data, error, count } = await db
      .from("subscriber_list_memberships")
      .select(
        "added_at, subscriber:subscribers(id, email, first_name, last_name, confirmed, suppressed, consent_source, created_at)",
        { count: "exact" }
      )
      .eq("list_id", listId)
      .eq("workspace_id", ctx.workspaceId)
      .order("added_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      logError(error, { route: "clients.subscriber-lists.members.get", workspaceId: ctx.workspaceId, listId });
      return NextResponse.json({ error: "Failed to load members" }, { status: 500 });
    }

    const members = (data ?? [])
      .filter((row) => row.subscriber)
      .map((row) => ({ ...row.subscriber, added_at: row.added_at }));

    return NextResponse.json({ list, members, total: count ?? 0, limit, offset });
  }
);

/**
 * DELETE /api/clients/[workspaceId]/subscriber-lists/[id]/members
 * Remove subscribers from a list. Body: { subscriber_ids: string[] }
 *
 * Removes membership only. The subscriber stays in the workspace, which is the
 * distinction that makes a list safe to curate - taking someone off a list is
 * not deleting them.
 */
export const DELETE = withWorkspace<{ workspaceId: string; id: string }>(
  async ({ req, ctx, db, params }) => {
    const listId = params.id;

    if (!isUuid(listId)) {
      return NextResponse.json({ error: "Invalid list ID" }, { status: 422 });
    }

    const parsed = addMembersSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "subscriber_ids must be an array of UUIDs" }, { status: 400 });
    }

    const { data, error } = await db
      .from("subscriber_list_memberships")
      .delete()
      .eq("list_id", listId)
      .eq("workspace_id", ctx.workspaceId)
      .in("subscriber_id", parsed.data.subscriber_ids)
      .select("subscriber_id");

    if (error) {
      logError(error, { route: "clients.subscriber-lists.members.delete", workspaceId: ctx.workspaceId, listId });
      return NextResponse.json({ error: "Failed to remove members" }, { status: 500 });
    }

    await audit(req, ctx, AUDIT_ACTIONS.LIST_MEMBERS_REMOVED, {
      list_id: listId,
      removed: data?.length ?? 0,
    });

    return NextResponse.json({ ok: true, removed: data?.length ?? 0 });
  },
  { minRole: "editor" }
);
