import { NextResponse } from "next/server";
import { isUuid } from "@/lib/route-params";
import { withWorkspace } from "@/lib/with-workspace";
import { logError } from "@/lib/logger";
import { logAudit, extractRequestMeta, AUDIT_ACTIONS } from "@/lib/audit-log";

const CORS = { "Access-Control-Allow-Origin": "*" };

export const PATCH = withWorkspace<{ workspaceId: string; id: string }>(
  async ({ req, ctx, db, params }) => {
    const { id } = params;

    if (!isUuid(id)) {
      return NextResponse.json({ error: "Invalid campaign ID" }, { status: 422, headers: CORS });
    }

    const { data: existing, error: checkError } = await db
      .from("campaigns")
      .select("id, status")
      .eq("id", id)
      .eq("workspace_id", ctx.workspaceId)
      .maybeSingle();

    if (checkError) {
      logError(checkError, { route: "clients.campaigns.update", workspaceId: ctx.workspaceId, id });
      return NextResponse.json({ error: "Failed to update campaign" }, { status: 500, headers: CORS });
    }
    if (!existing) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404, headers: CORS });
    }

    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: CORS });
    }

    const updateData: Record<string, unknown> = {};

    if (body.schedule_now) {
      updateData.status = "scheduled";
      updateData.scheduled_for = body.schedule_for || new Date().toISOString();
    } else {
      if (body.title !== undefined) updateData.title = body.title;
      if (body.subject !== undefined) updateData.subject = body.subject;
      if (body.audience !== undefined) updateData.audience = body.audience;
      if (body.editor_html !== undefined) updateData.editor_html = body.editor_html;
      if (body.editor_css !== undefined) updateData.editor_css = body.editor_css;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400, headers: CORS });
    }

    // Scope the write to the workspace as well. The existence check above already
    // 404s for other workspaces, but that leaves correctness depending on two
    // statements staying in sync across future edits.
    const { data, error } = await db
      .from("campaigns")
      .update(updateData)
      .eq("id", id)
      .eq("workspace_id", ctx.workspaceId)
      .select("*")
      .single();

    if (error) {
      logError(error, { route: "clients.campaigns.update", workspaceId: ctx.workspaceId, id });
      return NextResponse.json({ error: "Failed to update campaign" }, { status: 500, headers: CORS });
    }

    // Only the scheduling transition is audited, not every keystroke-driven
    // draft save. Committing a campaign to an audience is irreversible; editing
    // the subject line is not, and recording both would bury the one that
    // matters under hundreds of the one that does not.
    if (body.schedule_now) {
      const { ip, ua } = extractRequestMeta(req);
      await logAudit({
        workspace_id: ctx.workspaceId,
        user_id: ctx.userId,
        action: AUDIT_ACTIONS.CAMPAIGN_SCHEDULED,
        details: {
          campaign_id: id,
          subject: data.subject,
          audience: data.audience,
          scheduled_for: updateData.scheduled_for,
        },
        ip_address: ip,
        user_agent: ua,
      });
    }

    return NextResponse.json(data, { status: 200, headers: CORS });
  },
  { minRole: "editor" }
);

export const DELETE = withWorkspace<{ workspaceId: string; id: string }>(
  async ({ ctx, db, params }) => {
    const { id } = params;

    // PATCH validated the id and DELETE did not, even though both interpolated it
    // into a PostgREST URL. Parameterized now either way.
    if (!isUuid(id)) {
      return NextResponse.json({ error: "Invalid campaign ID" }, { status: 422, headers: CORS });
    }

    const { error } = await db
      .from("campaigns")
      .delete()
      .eq("id", id)
      .eq("workspace_id", ctx.workspaceId);

    if (error) {
      logError(error, { route: "clients.campaigns.delete", workspaceId: ctx.workspaceId, id });
      return NextResponse.json({ error: "Failed to delete campaign" }, { status: 500, headers: CORS });
    }

    return NextResponse.json({ ok: true }, { status: 200, headers: CORS });
  },
  { minRole: "editor" }
);
