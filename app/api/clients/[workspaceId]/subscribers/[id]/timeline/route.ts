import { NextResponse } from "next/server";
import { withWorkspace } from "@/lib/with-workspace";
import { isUuid } from "@/lib/route-params";
import { logError } from "@/lib/logger";

export const GET = withWorkspace<{ workspaceId: string; id: string }>(
  async ({ ctx, db, params }) => {
    const { id } = params;

    if (!isUuid(id)) {
      return NextResponse.json({ error: "Invalid subscriber ID" }, { status: 422 });
    }

    // Confirm the subscriber belongs to this workspace before reading anything
    // about them. The child tables below are keyed only by subscriber_id; this
    // gate used to be the only thing stopping an authenticated user reading
    // another workspace's notes, tags and events by guessing an id. Those tables
    // now carry workspace_id and a policy, so this determines 404 vs 200 rather
    // than carrying the isolation on its own.
    const { data: sub, error: subError } = await db
      .from("subscribers")
      .select("created_at, confirmed, health_score")
      .eq("id", id)
      .eq("workspace_id", ctx.workspaceId)
      .maybeSingle();

    if (subError) {
      logError(subError, {
        route: "clients.subscribers.timeline",
        workspaceId: ctx.workspaceId,
        subscriberId: id,
      });
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }
    if (!sub) {
      return NextResponse.json({ error: "Subscriber not found" }, { status: 404 });
    }

    const [eventsRes, tagsRes, notesRes] = await Promise.all([
      db.from("campaign_events")
        .select("event_type, occurred_at, campaign_id")
        .eq("subscriber_id", id)
        .order("occurred_at", { ascending: true })
        .limit(200),
      db.from("subscriber_tags")
        .select("tag, created_at")
        .eq("subscriber_id", id)
        .order("created_at", { ascending: true })
        .limit(100),
      // subscriber_notes does not exist in the database; this resolves as
      // { error } and contributes nothing to the timeline. See the notes route.
      db.from("subscriber_notes")
        .select("note, created_at")
        .eq("subscriber_id", id)
        .order("created_at", { ascending: true })
        .limit(50),
    ]);

    for (const [table, res] of Object.entries({
      campaign_events: eventsRes,
      subscriber_tags: tagsRes,
      subscriber_notes: notesRes,
    })) {
      if (res.error) {
        logError(res.error, {
          route: "clients.subscribers.timeline",
          workspaceId: ctx.workspaceId,
          subscriberId: id,
          table,
        });
      }
    }

    const events = eventsRes.data ?? [];
    const tags = tagsRes.data ?? [];
    const notes = notesRes.data ?? [];

    const timeline: Array<{ type: string; label: string; date: string; icon: string; detail?: string }> = [];

    if (sub?.created_at) {
      timeline.push({
        type: "subscribed",
        label: "Subscribed",
        date: sub.created_at,
        icon: "📬",
        detail: sub.confirmed ? "Confirmed" : "Pending confirmation",
      });
    }

    const eventLabels: Record<string, string> = {
      open: "Opened an email",
      click: "Clicked a link",
      bounce: "Email bounced",
      complaint: "Marked as spam",
    };
    const eventIcons: Record<string, string> = { open: "📖", click: "👆", bounce: "↩️" };
    for (const e of events) {
      const et = e.event_type || "unknown";
      timeline.push({
        type: et,
        label: eventLabels[et] || et,
        date: e.occurred_at,
        icon: eventIcons[et] || "⚠️",
      });
    }

    for (const t of tags) {
      timeline.push({ type: "tagged", label: `Tagged: ${t.tag}`, date: t.created_at, icon: "🏷️" });
    }

    for (const n of notes) {
      timeline.push({
        type: "note",
        label: "Note added",
        date: n.created_at,
        icon: "📝",
        detail: n.note?.slice(0, 120),
      });
    }

    if (sub?.health_score) {
      timeline.push({
        type: "health",
        label: `Health: ${sub.health_score.replace("_", " ")}`,
        date: new Date().toISOString(),
        icon: sub.health_score === "active" ? "🟢" : sub.health_score === "at_risk" ? "🟡" : "🔴",
      });
    }

    timeline.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    return NextResponse.json({ timeline });
  }
);
