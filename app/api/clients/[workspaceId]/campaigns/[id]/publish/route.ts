import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { getClientContextFromJWT, assertWorkspaceAccess } from "@/lib/client-context";

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
export async function POST(request: NextRequest, { params }: { params: Promise<{ workspaceId: string; id: string }> }) {
  const { workspaceId, id: campaignId } = await params;
  const context = getClientContextFromJWT(request);
  if (!context || !assertWorkspaceAccess(context, workspaceId)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseClient();

  // Fetch the campaign
  const { data: campaign, error: fetchError } = await supabase
    .from("campaigns")
    .select("id, title, status, public_slug, public_archive, published_at, editor_html, subject")
    .eq("id", campaignId)
    .eq("client_id", workspaceId)
    .single();

  if (fetchError || !campaign) {
    return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  }

  // Only sent campaigns can be published
  if (campaign.status !== "sent") {
    return NextResponse.json({ error: "Only sent campaigns can be published to the archive." }, { status: 422 });
  }

  const isCurrentlyPublic = campaign.public_archive;

  if (isCurrentlyPublic) {
    // Unpublish
    await supabase
      .from("campaigns")
      .update({ public_archive: false, published_at: null })
      .eq("id", campaignId);

    return NextResponse.json({ public: false, slug: null });
  } else {
    // Generate slug if not set
    let slug = campaign.public_slug;
    if (!slug) {
      slug = slugify(campaign.title || campaign.subject || "newsletter");
      // Ensure uniqueness by appending a short hash if needed
      const { data: existing } = await supabase
        .from("campaigns")
        .select("id")
        .eq("public_slug", slug)
        .neq("id", campaignId)
        .maybeSingle();

      if (existing) {
        const suffix = Math.random().toString(36).slice(2, 6);
        slug = `${slug}-${suffix}`;
      }
    }

    await supabase
      .from("campaigns")
      .update({ public_archive: true, public_slug: slug, published_at: new Date().toISOString() })
      .eq("id", campaignId);

    return NextResponse.json({ public: true, slug });
  }
}
