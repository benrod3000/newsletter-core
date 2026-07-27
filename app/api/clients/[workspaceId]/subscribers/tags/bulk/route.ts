import { NextResponse } from "next/server";
import { z } from "zod";
import { withWorkspace } from "@/lib/with-workspace";
import { logError } from "@/lib/logger";

const bulkTagSchema = z.object({
  subscriberIds: z.array(z.string().uuid()).min(1).max(1000),
  tag: z.string().trim().min(1).max(64),
});

/**
 * POST /api/clients/[workspaceId]/subscribers/tags/bulk
 * Apply one tag to many subscribers.
 */
export const POST = withWorkspace(
  async ({ req, ctx, db }) => {
    // The previous version built `or=(id=eq.<raw>,...)` by string concatenation
    // straight from the request body, with no validation, on a service-role
    // request. Validating as UUIDs and using .in() removes the injection surface
    // rather than trying to escape it.
    const parsed = bulkTagSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "subscriberIds (1-1000 UUIDs) and tag (string) are required" },
        { status: 400 }
      );
    }

    const { subscriberIds } = parsed.data;
    const normalizedTag = parsed.data.tag.toLowerCase();

    const { data: existing, error: verifyError } = await db
      .from("subscribers")
      .select("id")
      .eq("workspace_id", ctx.workspaceId)
      .in("id", subscriberIds);

    if (verifyError) {
      logError(verifyError, { route: "clients.subscribers.tags.bulk", workspaceId: ctx.workspaceId });
      return NextResponse.json({ error: "Failed to verify subscribers" }, { status: 500 });
    }

    const validIds = (existing ?? []).map((s) => s.id);
    if (validIds.length === 0) {
      return NextResponse.json(
        { error: "No valid subscribers found in this workspace" },
        { status: 400 }
      );
    }

    const rows = validIds.map((subscriberId) => ({
      subscriber_id: subscriberId,
      workspace_id: ctx.workspaceId,
      tag: normalizedTag,
    }));

    // Batched so a large selection does not build one enormous statement. The
    // previous version ignored the result of every batch, so a failure looked
    // identical to success.
    const batchSize = 100;
    for (let i = 0; i < rows.length; i += batchSize) {
      const { error } = await db
        .from("subscriber_tags")
        .upsert(rows.slice(i, i + batchSize), { ignoreDuplicates: true });

      if (error) {
        logError(error, {
          route: "clients.subscribers.tags.bulk",
          workspaceId: ctx.workspaceId,
          batchStart: i,
        });
        return NextResponse.json({ error: "Failed to apply tag" }, { status: 500 });
      }
    }

    return NextResponse.json(
      { ok: true, tagged: validIds.length, tag: normalizedTag },
      { status: 201 }
    );
  },
  // Tagging mutates audience data; a viewer could do it before.
  { minRole: "editor" }
);
