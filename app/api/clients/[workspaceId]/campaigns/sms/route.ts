import { NextRequest, NextResponse } from "next/server";
import { getClientContextFromJWT, assertWorkspaceAccess } from "@/lib/client-context";
import { logError } from "@/lib/logger";
import { smsEnabled, smsDisabledResponse } from "@/lib/features";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const auth = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  if (!smsEnabled()) return smsDisabledResponse();
  const { workspaceId } = await params;
  const ctx = getClientContextFromJWT(req);
  if (!ctx || !assertWorkspaceAccess(ctx, workspaceId))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Count SMS-reachable subscribers.
  //
  // Must apply the same filters as the send below, or the operator is shown a
  // recipient count that does not match who is actually texted. `suppressed` is
  // one of them: unsubscribe used to delete the row, so an opt-out could not be
  // counted here; it now keeps the row and sets a flag.
  const countRes = await fetch(
    `${SUPABASE_URL}/rest/v1/subscribers?select=count&workspace_id=eq.${workspaceId}&sms_consent=is.true&suppressed=is.false`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  const countData = await countRes.json();

  return NextResponse.json({
    reachable: countData?.[0]?.count ?? 0,
    message: "SMS/RCS campaigns use phone numbers with consent. Rich messaging (RCS) available for Android devices. SMS fallback for iOS.",
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  if (!smsEnabled()) return smsDisabledResponse();
  const { workspaceId } = await params;
  const ctx = getClientContextFromJWT(req);
  if (!ctx || !assertWorkspaceAccess(ctx, workspaceId))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { message, image_urls } = await req.json();
  if (!message?.trim()) return NextResponse.json({ error: "Message body is required" }, { status: 400 });

  const rcsImages = Array.isArray(image_urls) ? image_urls.filter((u: string) => u.startsWith('http')).slice(0, 10) : [];

  // Load Twilio credentials
  const credsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/clients?select=twilio_account_sid,twilio_auth_token,twilio_phone_number&id=eq.${encodeURIComponent(workspaceId)}&limit=1`,
    { headers: auth }
  );
  const creds = await credsRes.json();
  if (!Array.isArray(creds) || creds.length === 0) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }
  const { twilio_account_sid, twilio_auth_token, twilio_phone_number } = creds[0];
  if (!twilio_account_sid || !twilio_auth_token || !twilio_phone_number) {
    return NextResponse.json({ error: "SMS not configured. Add your Twilio credentials in Settings → SMS." }, { status: 400 });
  }

  // Fetch subscribers with phone + SMS consent. Keep these filters in step with
  // the count in GET above - an opt-out must not be texted, and the number the
  // operator was shown must be the number of people reached.
  const subsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/subscribers?select=id,phone,first_name&workspace_id=eq.${workspaceId}&sms_consent=is.true&suppressed=is.false&not.phone=is.null&limit=500`,
    { headers: auth, signal: AbortSignal.timeout(15000) }
  );
  const subscribers = await subsRes.json();
  if (!Array.isArray(subscribers) || subscribers.length === 0) {
    return NextResponse.json({ error: "No subscribers with phone number and SMS consent" }, { status: 400 });
  }

  const basicAuth = Buffer.from(`${twilio_account_sid}:${twilio_auth_token}`).toString("base64");
  let sent = 0;
  let failed = 0;

  // Send via Twilio in batches (rate limit: 1 msg/sec per phone number)
  for (const sub of subscribers) {
    const phone = sub.phone?.trim();
    if (!phone) continue;

    // Expect E.164 format (+1...). Missing prefix defaults to US.
    const cleanPhone = phone.startsWith("+") ? phone : `+1${phone.replace(/[\s\-()]/g, "")}`;
    if (cleanPhone.length < 10) { failed++; continue; }

    const personalMsg = message
      .replace(/\{\{first_name\}\}/g, sub.first_name || "there")
      .replace(/\{\{name\}\}/g, sub.first_name || "there");

    try {
      const twilioBody = new URLSearchParams({
        To: cleanPhone,
        From: twilio_phone_number,
        Body: personalMsg.slice(0, 1600),
      });
      rcsImages.forEach((url: string) => twilioBody.append('MediaUrl', url));

      const twilioRes = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${twilio_account_sid}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${basicAuth}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: twilioBody,
          signal: AbortSignal.timeout(15000),
        }
      );
      if (twilioRes.ok) sent++;
      else { failed++; logError(new Error(`Twilio send failed: ${twilioRes.status}`), { to: cleanPhone }) }
    } catch {
      failed++;
    }

    // Throttle to avoid rate limits
    if (subscribers.length > 10) await new Promise(r => setTimeout(r, 200));
  }

  return NextResponse.json({
    sent,
    failed,
    total: subscribers.length,
    message: `SMS sent to ${sent} recipients${failed > 0 ? `, ${failed} failed` : ""}.`,
  }, { status: 200 });
}
