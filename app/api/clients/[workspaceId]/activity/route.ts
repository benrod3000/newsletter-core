import { NextRequest, NextResponse } from "next/server";
import {
  getClientContextFromJWT,
  assertWorkspaceAccess,
} from "@/lib/client-context";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  const context = getClientContextFromJWT(req);
  if (!context || !assertWorkspaceAccess(context, workspaceId)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseUrl = process.env.SUPABASE_URL!;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const auth = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };
  const events: { type: string; description: string; timestamp: string }[] = [];

  try {
    // Recent campaigns
    const campRes = await fetch(
      `${supabaseUrl}/rest/v1/campaigns?client_id=eq.${workspaceId}&order=created_at.desc&limit=5`,
      { headers: auth }
    );
    const campaigns = await campRes.json();
    if (Array.isArray(campaigns)) {
      for (const c of campaigns) {
        events.push({
          type: c.status === 'sent' ? 'campaign_sent' : 'campaign_created',
          description: c.status === 'sent' ? `Campaign sent: ${c.title}` : `Draft created: ${c.title}`,
          timestamp: c.status === 'sent' ? c.last_sent_at || c.updated_at : c.created_at,
        });
      }
    }

    // Recent subscribers
    const subRes = await fetch(
      `${supabaseUrl}/rest/v1/subscribers?client_id=eq.${workspaceId}&order=created_at.desc&limit=5&select=email,created_at`,
      { headers: auth }
    );
    const subscribers = await subRes.json();
    if (Array.isArray(subscribers)) {
      for (const s of subscribers) {
        events.push({ type: 'subscriber_added', description: `New subscriber: ${s.email}`, timestamp: s.created_at });
      }
    }

    // Recent widget submissions
    const widgetRes = await fetch(
      `${supabaseUrl}/rest/v1/widget_submissions?select=email,created_at&limit=5`,
      { headers: auth }
    );
    const submissions = await widgetRes.json();
    if (Array.isArray(submissions)) {
      for (const w of submissions) {
        events.push({ type: 'form_submission', description: `Widget signup: ${w.email}`, timestamp: w.created_at });
      }
    }

    // Sort by timestamp DESC and take top 10
    events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return NextResponse.json({ activity: events.slice(0, 10) }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
