import { NextRequest, NextResponse } from "next/server";
import { getClientContextFromJWT, assertWorkspaceAccess } from "@/lib/client-context";
import { getSupabaseClient } from "@/lib/supabase";
import { isUuid } from "@/lib/route-params";
import { logError } from "@/lib/logger";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; id: string }> }
) {
  const { workspaceId, id } = await params;
  const ctx = getClientContextFromJWT(req);
  if (!ctx || !assertWorkspaceAccess(ctx, workspaceId))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!isUuid(id)) {
    return NextResponse.json({ error: "Invalid subscriber ID" }, { status: 422 });
  }

  try {
    const supabase = getSupabaseClient();

    // Confirm the subscriber belongs to this workspace BEFORE reading anything
    // about them. The child tables below are keyed only by subscriber_id, so
    // without this gate any authenticated user could read another workspace's
    // notes, tags and campaign events by guessing an id.
    const { data: sub, error: subError } = await supabase
      .from("subscribers")
      .select("created_at, confirmed, health_score")
      .eq("id", id)
      .eq("client_id", workspaceId)
      .maybeSingle();

    if (subError) {
      logError(subError, { route: "clients.subscribers.timeline", workspaceId, subscriberId: id });
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }
    if (!sub) {
      return NextResponse.json({ error: "Subscriber not found" }, { status: 404 });
    }

    const [eventsRes, tagsRes, notesRes] = await Promise.all([
      supabase
        .from("campaign_events")
        .select("event_type, occurred_at, campaign_id")
        .eq("subscriber_id", id)
        .order("occurred_at", { ascending: true })
        .limit(200),
      supabase
        .from("subscriber_tags")
        .select("tag, created_at")
        .eq("subscriber_id", id)
        .order("created_at", { ascending: true })
        .limit(100),
      supabase
        .from("subscriber_notes")
        .select("note, created_at")
        .eq("subscriber_id", id)
        .order("created_at", { ascending: true })
        .limit(50),
    ]);

    const events = eventsRes.data ?? [];
    const tags = tagsRes.data ?? [];
    const notes = notesRes.data ?? [];

    const timeline: Array<{ type: string; label: string; date: string; icon: string; detail?: string }> = [];

    // Subscribed event
    if (sub?.created_at) {
      timeline.push({
        type: 'subscribed',
        label: 'Subscribed',
        date: sub.created_at,
        icon: '📬',
        detail: sub.confirmed ? 'Confirmed' : 'Pending confirmation',
      });
    }

    // Campaign events
    const eventLabels: Record<string, string> = { open: 'Opened an email', click: 'Clicked a link', bounce: 'Email bounced', complaint: 'Marked as spam' };
    const eventIcons: Record<string, string> = { open: '📖', click: '👆', bounce: '↩️' };
    for (const e of (Array.isArray(events) ? events : [])) {
      const et = e.event_type || 'unknown';
      timeline.push({
        type: et,
        label: eventLabels[et] || et,
        date: e.occurred_at,
        icon: eventIcons[et] || '⚠️',
      });
    }

    // Tags applied
    for (const t of (Array.isArray(tags) ? tags : [])) {
      timeline.push({
        type: 'tagged',
        label: `Tagged: ${t.tag}`,
        date: t.created_at,
        icon: '🏷️',
      });
    }

    // Notes added
    for (const n of (Array.isArray(notes) ? notes : [])) {
      timeline.push({
        type: 'note',
        label: 'Note added',
        date: n.created_at,
        icon: '📝',
        detail: n.note?.slice(0, 120),
      });
    }

    // Health check
    if (sub?.health_score) {
      timeline.push({
        type: 'health',
        label: `Health: ${sub.health_score.replace('_', ' ')}`,
        date: new Date().toISOString(),
        icon: sub.health_score === 'active' ? '🟢' : sub.health_score === 'at_risk' ? '🟡' : '🔴',
      });
    }

    // Sort by date ascending
    timeline.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    return NextResponse.json({ timeline });
  } catch (e) {
    // Don't return e.message: internal errors leak schema and query details.
    logError(e, { route: "clients.subscribers.timeline", workspaceId, subscriberId: id });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
