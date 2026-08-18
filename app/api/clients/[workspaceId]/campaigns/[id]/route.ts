import { NextResponse } from "next/server";
import { isUuid } from "@/lib/route-params";
import { withWorkspace } from "@/lib/with-workspace";
import { logError } from "@/lib/logger";
import { logAudit, extractRequestMeta, audit, AUDIT_ACTIONS } from "@/lib/audit-log";
import { isValidAudience, FIXED_AUDIENCES } from "@/lib/send-campaign";

const CORS = { "Access-Control-Allow-Origin": "*" };

/** How far into the past a requested send time may fall before it is rejected. */
const PAST_SCHEDULE_TOLERANCE_MS = 60_000;

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

    if (body.unschedule) {
      // Returning a pending campaign to draft. Without this the only way out of
      // "scheduled" was to wait for the send or edit the row by hand.
      if (existing.status !== "scheduled") {
        return NextResponse.json(
          { error: `Only a scheduled campaign can be unscheduled (this one is ${existing.status}).` },
          { status: 409, headers: CORS }
        );
      }
      updateData.status = "draft";
      updateData.scheduled_for = null;
    } else if (body.schedule_now) {
      if (existing.status === "sent" || existing.status === "sending") {
        return NextResponse.json(
          { error: `This campaign is already ${existing.status}.` },
          { status: 409, headers: CORS }
        );
      }

      // `schedule_for` was previously passed straight through with
      // `body.schedule_for || new Date().toISOString()`. An unparseable value
      // reached Postgres as-is, and anything falsy - including the empty string
      // a cleared date input produces - silently became "now", which is how a
      // campaign nobody meant to schedule ends up pending.
      let scheduledFor: string;
      if (body.schedule_for === undefined || body.schedule_for === null) {
        scheduledFor = new Date().toISOString();
      } else {
        if (typeof body.schedule_for !== "string" || !body.schedule_for.trim()) {
          return NextResponse.json(
            { error: "schedule_for must be an ISO 8601 timestamp." },
            { status: 422, headers: CORS }
          );
        }
        const parsed = new Date(body.schedule_for);
        if (Number.isNaN(parsed.getTime())) {
          return NextResponse.json(
            { error: `"${body.schedule_for}" is not a valid date/time.` },
            { status: 422, headers: CORS }
          );
        }
        // A past time is accepted only within a small tolerance, which absorbs
        // clock skew and the seconds between picking a time and submitting it.
        // Beyond that it is a mistake worth reporting: the processor sends
        // anything already due on its next pass, so a date entered as last week
        // would go out immediately rather than being held.
        if (parsed.getTime() < Date.now() - PAST_SCHEDULE_TOLERANCE_MS) {
          return NextResponse.json(
            { error: "That time is in the past. Pick a future time, or send now." },
            { status: 422, headers: CORS }
          );
        }
        scheduledFor = parsed.toISOString();
      }

      updateData.status = "scheduled";
      updateData.scheduled_for = scheduledFor;
    } else {
      if (body.title !== undefined) updateData.title = body.title;
      if (body.subject !== undefined) updateData.subject = body.subject;
      if (body.audience !== undefined) {
        // Validated here rather than left to the CHECK constraint, which reports a
        // rejected value as a 500 with no indication of the column. A draft that
        // silently refuses to save is the symptom that produced.
        if (!isValidAudience(body.audience)) {
          return NextResponse.json(
            {
              error:
                `"${body.audience}" is not a valid audience. Use one of ` +
                `${FIXED_AUDIENCES.join(", ")}, or list:<uuid>.`,
            },
            { status: 400, headers: CORS }
          );
        }
        updateData.audience = body.audience;
      }
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
    if (body.schedule_now || body.unschedule) {
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
          unscheduled: Boolean(body.unschedule),
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
  async ({ req, ctx, db, params }) => {
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

    await audit(req, ctx, AUDIT_ACTIONS.CAMPAIGN_DELETED, { campaign_id: id });

    return NextResponse.json({ ok: true }, { status: 200, headers: CORS });
  },
  { minRole: "editor" }
);
