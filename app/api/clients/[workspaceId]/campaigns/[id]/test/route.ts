import { NextRequest, NextResponse } from "next/server";
import { getClientContextFromJWT, assertWorkspaceAccess } from "@/lib/client-context";
import { sendEmail } from "@/lib/email-sender";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; id: string }> }
) {
  const { workspaceId, id } = await params;
  const context = getClientContextFromJWT(req);

  if (!context || !assertWorkspaceAccess(context, workspaceId)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { email } = body;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Valid test email required" }, { status: 400 });
  }

  const supabaseUrl = process.env.SUPABASE_URL!;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const auth = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };

  try {
    // Fetch campaign
    const campRes = await fetch(
      `${supabaseUrl}/rest/v1/campaigns?id=eq.${encodeURIComponent(id)}&workspace_id=eq.${encodeURIComponent(workspaceId)}&limit=1`,
      { headers: auth }
    );
    const campaigns = await campRes.json();
    if (!Array.isArray(campaigns) || campaigns.length === 0) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    const campaign = campaigns[0];

    // Fetch branding for sender config
    const brandRes = await fetch(
      `${supabaseUrl}/rest/v1/branding?workspace_id=eq.${encodeURIComponent(workspaceId)}&limit=1`,
      { headers: auth }
    );
    const branding = await brandRes.json();
    const brand = Array.isArray(branding) ? branding[0] : null;

    // Build sender config from branding
    const fromEmail = brand?.sender_email || brand?.ses_from_email || "noreply@veloce.app";
    const fromName = brand?.sender_name || "Veloce";
    const from = `${fromName} <${fromEmail}>`;

    await sendEmail(
      {
        to: email,
        from,
        subject: `[TEST] ${campaign.subject || campaign.title}`,
        html: campaign.editor_html || `<p>This is a test email for campaign "${campaign.title}".</p>`,
      },
      {
        provider: brand?.email_provider || "sendgrid",
        sendgridApiKey: process.env.SENDGRID_API_KEY || undefined,
        sesAccessKey: brand?.ses_access_key || undefined,
        sesSecretKey: brand?.ses_secret_key || undefined,
        sesRegion: brand?.ses_region || "us-east-1",
      }
    );

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e: any) {
    console.error("Test send error:", e?.message);
    return NextResponse.json({ error: e?.message || "Failed to send test email" }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}
