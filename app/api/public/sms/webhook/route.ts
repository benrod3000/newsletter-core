import { NextRequest, NextResponse } from "next/server";
import { toE164 } from "@/lib/phone";

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
      // Twilio always sends `From` in E.164, and `phone_number` is stored in
      // E.164 since migration 072, so this is now an exact match.
      //
      // It used to be `phone=ilike.*<digits>`, a trailing wildcard over a column
      // whose format nothing guaranteed. A suffix match opts out whoever happens
      // to share those trailing digits, which for an opt-out is the worst
      // direction to be wrong in: the person who asked to be left alone keeps
      // getting messages and someone who never asked stops.
      //
      // Two things here are still wrong and are M4's job, not this change:
      // there is no `X-Twilio-Signature` check, so anyone can POST a number and
      // opt that person out; and the lookup is not workspace-scoped, so a STOP
      // lands on one arbitrary tenant's row.
      const normalized = toE164(from);
      if (!normalized) {
        return NextResponse.json({ error: "Unreadable From number" }, { status: 400 });
      }

      const data = await fetch(
        `${SUPABASE_URL}/rest/v1/subscribers?phone_number=eq.${encodeURIComponent(normalized)}&select=id`,
        { headers: auth }
      ).then((r) => r.json());

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
