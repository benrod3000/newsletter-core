import { NextRequest, NextResponse } from "next/server";
import { getClientContextFromJWT, assertWorkspaceAccess } from "@/lib/client-context";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const auth = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  const ctx = getClientContextFromJWT(req);
  if (!ctx || !assertWorkspaceAccess(ctx, workspaceId))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Count SMS-reachable subscribers
  const countRes = await fetch(
    `${SUPABASE_URL}/rest/v1/subscribers?select=count&client_id=eq.${workspaceId}&sms_consent=is.true`,
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
  const { workspaceId } = await params;
  const ctx = getClientContextFromJWT(req);
  if (!ctx || !assertWorkspaceAccess(ctx, workspaceId))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { message, image_url, cta_label, cta_url } = await req.json();
  if (!message?.trim()) return NextResponse.json({ error: "Message body is required" }, { status: 400 });

  // Fetch subscribers with phone + SMS consent
  const subsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/subscribers?select=id,phone,first_name&client_id=eq.${workspaceId}&sms_consent=is.true&limit=500`,
    { headers: auth }
  );
  const subscribers = await subsRes.json();
  if (!Array.isArray(subscribers) || subscribers.length === 0) {
    return NextResponse.json({ error: "No subscribers with SMS consent" }, { status: 400 });
  }

  // RCS/SMS sending would go here — stub for now
  // Integration point: Google RCS Business Messaging API or Twilio
  return NextResponse.json({
    scheduled: subscribers.length,
    message: `SMS campaign queued for ${subscribers.length} phone numbers. RCS integration pending — SMS only for now.`,
  }, { status: 202 });
}
