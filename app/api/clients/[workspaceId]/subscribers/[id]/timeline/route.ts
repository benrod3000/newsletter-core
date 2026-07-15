import { NextRequest, NextResponse } from "next/server";
import { getClientContextFromJWT, assertWorkspaceAccess } from "@/lib/client-context";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const auth = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; id: string }> }
) {
  const { workspaceId, id } = await params;
  const ctx = getClientContextFromJWT(req);
  if (!ctx || !assertWorkspaceAccess(ctx, workspaceId))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    // Fetch event types in parallel
    const [eventsRes, tagsRes, notesRes, subRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/campaign_events?select=event_type,occurred_at,campaign_id&subscriber_id=eq.${id}&order=occurred_at.asc&limit=200`, { headers: auth }),
      fetch(`${SUPABASE_URL}/rest/v1/subscriber_tags?select=tag,created_at&subscriber_id=eq.${id}&order=created_at.asc&limit=100`, { headers: auth }),
      fetch(`${SUPABASE_URL}/rest/v1/subscriber_notes?select=note,created_at&subscriber_id=eq.${id}&order=created_at.asc&limit=50`, { headers: auth }),
      fetch(`${SUPABASE_URL}/rest/v1/subscribers?select=created_at,confirmed,health_score&id=eq.${id}&limit=1`, { headers: auth }),
    ]);

    const [events, tags, notes, subData] = await Promise.all([
      eventsRes.json(), tagsRes.json(), notesRes.json(), subRes.json(),
    ]);

    const timeline: Array<{ type: string; label: string; date: string; icon: string; detail?: string }> = [];
    const sub: any = Array.isArray(subData) ? subData[0] : null;

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
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Internal error" }, { status: 500 });
  }
}
