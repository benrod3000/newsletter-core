import { NextResponse } from "next/server";
import { withWorkspace } from "@/lib/with-workspace";
import { smsEnabled, smsDisabledResponse } from "@/lib/features";
import { toE164 } from "@/lib/phone";

const CORS = { "Access-Control-Allow-Origin": "*" };

/**
 * POST /api/clients/[workspaceId]/sms/test
 * Send a test SMS using the workspace's Twilio credentials.
 * Body: { to: string }
 */
export const POST = withWorkspace<{ workspaceId: string }>(
  async ({ req, params }) => {
  if (!smsEnabled()) return smsDisabledResponse();
    const { workspaceId } = params;
  let body: { to?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400, headers: CORS });
  }

  // One definition of what a phone number is. This route had its own, slightly
  // different from the send loop's, which is how the same number could be
  // accepted here and rejected there.
  const formattedTo = toE164(body.to, "US");
  if (!formattedTo) {
    return NextResponse.json(
      { error: "Valid phone number required, in international format (e.g. +15125550199)" },
      { status: 400, headers: CORS }
    );
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
},
  { minRole: "owner" }
);
