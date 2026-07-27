import { NextResponse } from "next/server";
import { z } from "zod";
import { withWorkspace } from "@/lib/with-workspace";
import { isUuid } from "@/lib/route-params";
import { logError } from "@/lib/logger";

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
