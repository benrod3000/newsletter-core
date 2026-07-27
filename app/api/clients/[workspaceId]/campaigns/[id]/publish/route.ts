import { NextResponse } from "next/server";
import { withWorkspace } from "@/lib/with-workspace";
import { isUuid } from "@/lib/route-params";
import { logError } from "@/lib/logger";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

/**
 * POST /api/clients/{workspaceId}/campaigns/{id}/publish
 * Toggles the public archive status for a sent campaign.
 * Auto-generates a slug from the campaign title on first publish.
 */
export const POST = withWorkspace<{ workspaceId: string; id: string }>(
  async ({ ctx, db, params }) => {
    const campaignId = params.id;

    if (!isUuid(campaignId)) {
      return NextResponse.json({ error: "Invalid campaign ID" }, { status: 422 });
    }

    const { data: campaign, error: fetchError } = await db
      .from("campaigns")
      .select("id, title, status, public_slug, public_archive, published_at, editor_html, subject")
      .eq("id", campaignId)
      .eq("workspace_id", ctx.workspaceId)
      .maybeSingle();

    if (fetchError) {
      logError(fetchError, { route: "clients.campaigns.publish", workspaceId: ctx.workspaceId, campaignId });
      return NextResponse.json({ error: "Failed to publish campaign" }, { status: 500 });
    }
    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
    }

    if (campaign.status !== "sent") {
      return NextResponse.json(
        { error: "Only sent campaigns can be published to the archive." },
        { status: 422 }
      );
    }

    if (campaign.public_archive) {
      const { error } = await db
        .from("campaigns")
        .update({ public_archive: false, published_at: null })
        .eq("id", campaignId)
        // Both writes below used to filter on id alone. The fetch above
        // established ownership, so this was correct in practice, but only for as
        // long as the two statements stayed in step through future edits.
        .eq("workspace_id", ctx.workspaceId);

      if (error) {
        logError(error, { route: "clients.campaigns.publish", workspaceId: ctx.workspaceId, campaignId });
        return NextResponse.json({ error: "Failed to unpublish campaign" }, { status: 500 });
      }

      return NextResponse.json({ public: false, slug: null });
    }

    let slug = campaign.public_slug;
    if (!slug) {
      slug = slugify(campaign.title || campaign.subject || "newsletter");

      // NOTE: this uniqueness check is deliberately global, not per workspace,
      // because /newsletter/[slug] is a single global namespace. That is exactly
      // the squatting problem ARCHITECTURE.md section 10 names - the first
      // workspace to publish "weekly-update" takes it from every other tenant
      // permanently. The fix is per-workspace hosting domains, which is Phase 4;
      // narrowing this check without that in place would mint colliding public
      // URLs, which is worse.
      const { data: existing, error: slugError } = await db
        .from("campaigns")
        .select("id")
        .eq("public_slug", slug)
        .neq("id", campaignId)
        .maybeSingle();

      if (slugError) {
        logError(slugError, { route: "clients.campaigns.publish", workspaceId: ctx.workspaceId, campaignId });
        return NextResponse.json({ error: "Failed to publish campaign" }, { status: 500 });
      }

      if (existing) {
        slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
      }
    }

    const { error } = await db
      .from("campaigns")
      .update({
        public_archive: true,
        public_slug: slug,
        published_at: new Date().toISOString(),
      })
      .eq("id", campaignId)
      .eq("workspace_id", ctx.workspaceId);

    if (error) {
      logError(error, { route: "clients.campaigns.publish", workspaceId: ctx.workspaceId, campaignId });
      return NextResponse.json({ error: "Failed to publish campaign" }, { status: 500 });
    }

    return NextResponse.json({ public: true, slug });
  },
  // Publishing puts a campaign on the public internet under the workspace's name.
  // There was no role check at all, so a viewer could publish or unpublish.
  { minRole: "editor" }
);
