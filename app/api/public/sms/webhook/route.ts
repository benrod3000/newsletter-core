import { NextRequest, NextResponse } from "next/server";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const auth = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" };

/**
 * POST /api/public/sms/webhook
 * Handles incoming SMS replies: STOP = opt out, HELP = instructions.
 * This would be configured as a Twilio/Signal webhook URL.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.text();
    const params = new URLSearchParams(body);
    const from = params.get("From") || "";
    const body_text = (params.get("Body") || "").trim().toUpperCase();

    if (!from) return NextResponse.json({ error: "Missing From" }, { status: 400 });

    if (body_text === "STOP" || body_text === "UNSUBSCRIBE" || body_text === "CANCEL") {
      // Opt out this phone number
      const normalized = from.replace(/^\+1/, "").replace(/\D/g, "");
      await fetch(`${SUPABASE_URL}/rest/v1/subscribers?phone=ilike.*${normalized}&select=id`, { headers: auth });
      const data = await fetch(`${SUPABASE_URL}/rest/v1/subscribers?phone=ilike.*${normalized}&select=id`, { headers: auth }).then(r => r.json());

      if (Array.isArray(data) && data.length > 0) {
        await fetch(`${SUPABASE_URL}/rest/v1/subscribers?id=eq.${data[0].id}`, {
          method: "PATCH",
          headers: auth,
          body: JSON.stringify({ sms_consent: false, sms_consented_at: null }),
        });
      }

      // Return TwiML response
      return new NextResponse(
        `<?xml version="1.0" encoding="UTF-8"?><Response><Message>You've been unsubscribed from SMS messages. Reply HELP for help.</Message></Response>`,
        { status: 200, headers: { "Content-Type": "text/xml" } }
      );
    }

    if (body_text === "HELP") {
      return new NextResponse(
        `<?xml version="1.0" encoding="UTF-8"?><Response><Message>Veloce SMS messages. Reply STOP to unsubscribe. Msg & data rates may apply.</Message></Response>`,
        { status: 200, headers: { "Content-Type": "text/xml" } }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
