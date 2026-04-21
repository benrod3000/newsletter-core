import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { canEditCampaigns, getAdminContextFromHeaders } from "@/lib/admin-context";

type CampaignStatus = "draft" | "scheduled" | "sent";
type Audience = "all" | "confirmed" | "pending";

function parseAudience(value: unknown): Audience {
  if (value === "all" || value === "pending") return value;
  return "confirmed";
}

function parseStatus(value: unknown): CampaignStatus {
  if (value === "scheduled" || value === "sent") return value;
  return "draft";
}

async function resolveClientId(inputClientId: unknown, adminClientId: string | null) {
  if (adminClientId) return adminClientId;
  if (typeof inputClientId === "string" && inputClientId.trim()) return inputClientId.trim();

  const supabase = getSupabaseClient();
  const { data } = await supabase
    .from("clients")
    .select("id")
    .eq("slug", "default")
    .maybeSingle();

  return data?.id ?? null;
}

export async function GET(req: NextRequest) {
  const admin = getAdminContextFromHeaders(req.headers);
  if (!admin) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (admin.role !== "owner" && !admin.clientId) {
    return NextResponse.json({ error: "No workspace assigned for this account." }, { status: 403 });
  }

  const supabase = getSupabaseClient();
  let campaignsQuery = supabase
    .from("campaigns")
    .select("id, client_id, title, subject, audience, status, editor_html, editor_css, plain_text, scheduled_for, sent_count, last_sent_at, last_test_sent_at, last_test_recipient, updated_at")
    .order("updated_at", { ascending: false });

  if (admin.role !== "owner" && admin.clientId) {
    campaignsQuery = campaignsQuery.eq("client_id", admin.clientId);
  }

  const { data: campaigns, error } = await campaignsQuery;
  if (error) {
    return NextResponse.json({ error: `Failed to load campaigns: ${error.message}` }, { status: 500 });
  }

  const clientsQuery = admin.role === "owner"
    ? supabase.from("clients").select("id, name, slug").order("name", { ascending: true })
    : supabase.from("clients").select("id, name, slug").eq("id", admin.clientId ?? "").limit(1);

  const { data: clients, error: clientsError } = await clientsQuery;
  if (clientsError) {
    return NextResponse.json({ error: `Failed to load clients: ${clientsError.message}` }, { status: 500 });
  }

  return NextResponse.json({
    campaigns: campaigns ?? [],
    clients: clients ?? [],
    admin,
  });
}

export async function POST(req: NextRequest) {
  const admin = getAdminContextFromHeaders(req.headers);
  if (!admin) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (!canEditCampaigns(admin)) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  if (admin.role !== "owner" && !admin.clientId) {
    return NextResponse.json({ error: "No workspace assigned for this account." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body.subject !== "string" || typeof body.editorHtml !== "string") {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const supabase = getSupabaseClient();
  const id = typeof body.id === "string" ? body.id : null;
  const title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : "Untitled Draft";
  const subject = body.subject.trim();
  const audience = parseAudience(body.audience);
  const status = parseStatus(body.status);
  const editorHtml = body.editorHtml.trim();
  const editorCss = typeof body.editorCss === "string" ? body.editorCss : "";
  const plainText = typeof body.plainText === "string" ? body.plainText : "";
  const scheduledFor = typeof body.scheduledFor === "string" && body.scheduledFor.trim() ? body.scheduledFor : null;

  if (!subject || !editorHtml) {
    return NextResponse.json({ error: "Subject and content are required." }, { status: 422 });
  }

  if (status === "scheduled" && !scheduledFor) {
    return NextResponse.json({ error: "Scheduled campaigns require a schedule date/time." }, { status: 422 });
  }

  const clientId = await resolveClientId(body.clientId, admin.clientId);
  if (!clientId) {
    return NextResponse.json({ error: "No workspace selected for this campaign." }, { status: 422 });
  }

  const payload = {
    client_id: clientId,
    title,
    subject,
    audience,
    status,
    editor_html: editorHtml,
    editor_css: editorCss,
    plain_text: plainText,
    scheduled_for: status === "scheduled" ? scheduledFor : null,
    updated_by: admin.username,
    created_by: admin.username,
  };

  if (id) {
    let update = supabase.from("campaigns").update(payload).eq("id", id).select("*").single();
    if (admin.role !== "owner" && admin.clientId) {
      update = supabase
        .from("campaigns")
        .update(payload)
        .eq("id", id)
        .eq("client_id", admin.clientId)
        .select("*")
        .single();
    }

    const { data, error } = await update;
    if (error) {
      return NextResponse.json({ error: `Failed to update campaign: ${error.message}` }, { status: 500 });
    }

    return NextResponse.json({ campaign: data });
  }

  const { data, error } = await supabase
    .from("campaigns")
    .insert([{ ...payload, created_by: admin.username }])
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: `Failed to create campaign: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ campaign: data }, { status: 201 });
}
