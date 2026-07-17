import { NextRequest, NextResponse } from "next/server";
import { getClientContextFromJWT, assertWorkspaceAccess, isClientOwner } from "@/lib/client-context";

const CORS = { "Access-Control-Allow-Origin": "*" };

/**
 * POST /api/clients/[workspaceId]/sms/test
 * Send a test SMS using the workspace's Twilio credentials.
 * Body: { to: string }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  const ctx = getClientContextFromJWT(req);
  if (!ctx || !assertWorkspaceAccess(ctx, workspaceId))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: CORS });

  let body: { to?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400, headers: CORS });
  }

  const to = body.to?.trim();
  if (!to || !/^\+?1?\d{10,15}$/.test(to.replace(/[\s\-()]/g, ""))) {
    return NextResponse.json({ error: "Valid US phone number required (e.g. +15125550199)" }, { status: 400, headers: CORS });
  }

  // Load Twilio credentials from workspace branding
  const supabaseUrl = process.env.SUPABASE_URL!;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const auth = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };

  const res = await fetch(
    `${supabaseUrl}/rest/v1/clients?select=twilio_account_sid,twilio_auth_token,twilio_phone_number&id=eq.${encodeURIComponent(workspaceId)}&limit=1`,
    { headers: auth }
  );
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404, headers: CORS });
  }

  const { twilio_account_sid, twilio_auth_token, twilio_phone_number } = data[0];
  if (!twilio_account_sid || !twilio_auth_token || !twilio_phone_number) {
    return NextResponse.json(
      { error: "SMS not configured. Add your Twilio credentials in Settings." },
      { status: 400, headers: CORS }
    );
  }

  const cleanTo = to.replace(/[\s\-()]/g, "");
  const formattedTo = cleanTo.startsWith("+") ? cleanTo : `+1${cleanTo}`;

  try {
    const twilioRes = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${twilio_account_sid}/Messages.json`,
      {
        method: "POST",
        headers: {
          "Authorization": `Basic ${Buffer.from(`${twilio_account_sid}:${twilio_auth_token}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          To: formattedTo,
          From: twilio_phone_number,
          Body: "This is a test message from Veloce. Your SMS provider is connected and working!",
        }),
      }
    );

    const twilioData = await twilioRes.json();

    if (!twilioRes.ok) {
      return NextResponse.json(
        { error: `Twilio error: ${twilioData.message || twilioData.code || "Unknown"}` },
        { status: 400, headers: CORS }
      );
    }

    return NextResponse.json({
      ok: true,
      sid: twilioData.sid,
      status: twilioData.status,
      to: formattedTo,
      from: twilio_phone_number,
    }, { headers: CORS });
  } catch (err: any) {
    return NextResponse.json(
      { error: `Failed to send: ${err?.message || "Network error"}` },
      { status: 500, headers: CORS }
    );
  }
}
