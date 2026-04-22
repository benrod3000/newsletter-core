import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { getAdminContextFromHeaders } from "@/lib/admin-context";

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = getAdminContextFromHeaders(req.headers);
  if (!admin) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Invalid subscriber ID." }, { status: 422 });
  }

  const supabase = getSupabaseClient();
  let subscriberQuery = supabase
    .from("subscribers")
    .select("*")
    .eq("id", id)
    .single();

  if (admin.role !== "owner" && admin.clientId) {
    subscriberQuery = supabase
      .from("subscribers")
      .select("*")
      .eq("id", id)
      .eq("client_id", admin.clientId)
      .single();
  }

  const { data: subscriber, error: subscriberError } = await subscriberQuery;
  if (subscriberError || !subscriber) {
    return NextResponse.json({ error: "Subscriber not found." }, { status: 404 });
  }

  const { data: events, error: eventsError } = await supabase
    .from("campaign_events")
    .select("id, campaign_id, event_type, url, metadata, occurred_at")
    .eq("subscriber_id", id)
    .order("occurred_at", { ascending: false });

  if (eventsError) {
    return NextResponse.json({ error: `Failed to load subscriber events: ${eventsError.message}` }, { status: 500 });
  }

  return NextResponse.json({
    exportedAt: new Date().toISOString(),
    subscriber,
    events: events ?? [],
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = getAdminContextFromHeaders(req.headers);
  if (!admin) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (admin.role === "viewer") return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Invalid subscriber ID." }, { status: 422 });
  }

  const supabase = getSupabaseClient();
  let subscriberQuery = supabase
    .from("subscribers")
    .select("id, email, client_id")
    .eq("id", id)
    .single();

  if (admin.role !== "owner" && admin.clientId) {
    subscriberQuery = supabase
      .from("subscribers")
      .select("id, email, client_id")
      .eq("id", id)
      .eq("client_id", admin.clientId)
      .single();
  }

  const { data: subscriber, error: subscriberError } = await subscriberQuery;
  if (subscriberError || !subscriber) {
    return NextResponse.json({ error: "Subscriber not found." }, { status: 404 });
  }

  const { error: eventUpdateError } = await supabase
    .from("campaign_events")
    .update({
      email: "deleted@redacted.local",
      metadata: {
        gdpr_erased: true,
        gdpr_erased_at: new Date().toISOString(),
        gdpr_erased_by: admin.username,
      },
    })
    .eq("subscriber_id", id);

  if (eventUpdateError) {
    return NextResponse.json({ error: `Failed to sanitize subscriber events: ${eventUpdateError.message}` }, { status: 500 });
  }

  let deleteQuery = supabase.from("subscribers").delete().eq("id", id);
  if (admin.role !== "owner" && admin.clientId) {
    deleteQuery = supabase.from("subscribers").delete().eq("id", id).eq("client_id", admin.clientId);
  }

  const { error: deleteError } = await deleteQuery;
  if (deleteError) {
    return NextResponse.json({ error: `Failed to delete subscriber: ${deleteError.message}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true, deletedSubscriberId: id });
}