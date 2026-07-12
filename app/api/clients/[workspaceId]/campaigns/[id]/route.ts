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
 * PATCH /api/clients/[workspaceId]/campaigns/[id]
 * Update a draft campaign (name, subject, audience) or schedule it for sending.
 * JWT authenticated, requires edit permission.
 *
 * Body (edit):   { name?: string; subject?: string; audience?: string }
 * Body (schedule): { schedule_now: true }
 *
 * Only campaigns with status === "draft" can be updated or scheduled.
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
    return NextResponse.json(
      { error: "Insufficient permissions" },
      { status: 403 }
    );
  }

  if (!isUuid(id)) {
    return NextResponse.json({ error: "Invalid campaign ID" }, { status: 422 });
  }

  const supabase = getSupabaseClient();

  // Verify the campaign exists, belongs to this workspace, and is a draft.
  const { data: campaign, error: fetchError } = await supabase
    .from("campaigns")
    .select("id, status")
    .eq("id", id)
    .eq("client_id", workspaceId)
    .single();

  if (fetchError || !campaign) {
    return NextResponse.json(
      { error: "Campaign not found" },
      { status: 404 }
    );
  }

  if (campaign.status !== "draft") {
    return NextResponse.json(
      { error: "Only draft campaigns can be modified" },
      { status: 409 }
    );
  }

  const body = await req.json();

  // Schedule-now shortcut.
  if (body.schedule_now === true) {
    const { error: scheduleError } = await supabase
      .from("campaigns")
      .update({
        status: "scheduled",
        scheduled_for: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("client_id", workspaceId);

    if (scheduleError) {
      console.error("Campaign schedule error:", scheduleError);
      return NextResponse.json(
        { error: "Failed to schedule campaign" },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, status: "scheduled" });
  }

  // Partial update (name, subject, audience).
  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (body.name !== undefined) updates.name = body.name;
  if (body.subject !== undefined) updates.subject = body.subject;
  if (body.audience !== undefined) updates.audience = body.audience;

  if (Object.keys(updates).length === 1) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const { error: updateError } = await supabase
    .from("campaigns")
    .update(updates)
    .eq("id", id)
    .eq("client_id", workspaceId);

  if (updateError) {
    console.error("Campaign update error:", updateError);
    return NextResponse.json(
      { error: "Failed to update campaign" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/clients/[workspaceId]/campaigns/[id]
 * Delete a draft campaign. JWT authenticated, requires edit permission.
 *
 * Only campaigns with status === "draft" can be deleted.
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
    return NextResponse.json(
      { error: "Insufficient permissions" },
      { status: 403 }
    );
  }

  if (!isUuid(id)) {
    return NextResponse.json({ error: "Invalid campaign ID" }, { status: 422 });
  }

  const supabase = getSupabaseClient();

  // Verify the campaign exists, belongs to this workspace, and is a draft.
  const { data: campaign, error: fetchError } = await supabase
    .from("campaigns")
    .select("id, status")
    .eq("id", id)
    .eq("client_id", workspaceId)
    .single();

  if (fetchError || !campaign) {
    return NextResponse.json(
      { error: "Campaign not found" },
      { status: 404 }
    );
  }

  if (campaign.status !== "draft") {
    return NextResponse.json(
      { error: "Only draft campaigns can be deleted" },
      { status: 409 }
    );
  }

  const { error: deleteError } = await supabase
    .from("campaigns")
    .delete()
    .eq("id", id)
    .eq("client_id", workspaceId);

  if (deleteError) {
    console.error("Campaign delete error:", deleteError);
    return NextResponse.json(
      { error: "Failed to delete campaign" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
