import { NextRequest, NextResponse } from "next/server";
import {
  getClientContextFromJWT,
  assertWorkspaceAccess,
  isClientOwner,
} from "@/lib/client-context";

const CORS = { "Access-Control-Allow-Origin": "*" };
const BRANDING_FIELDS = "id,logo_url,brand_colors,custom_domain,sender_name,sender_email,email_provider,ses_region,ses_from_email,resend_api_key,twilio_account_sid,twilio_auth_token,twilio_phone_number";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  const context = getClientContextFromJWT(req);
  if (!context || !assertWorkspaceAccess(context, workspaceId)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: CORS });
  }
  const supabaseUrl = process.env.SUPABASE_URL!;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const auth = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };
  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/clients?select=${BRANDING_FIELDS}&id=eq.${encodeURIComponent(workspaceId)}&limit=1`,
      { headers: auth }
    );
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404, headers: CORS });
    }
    return NextResponse.json(data[0], { status: 200, headers: CORS });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: CORS });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  const context = getClientContextFromJWT(req);
  if (!context || !assertWorkspaceAccess(context, workspaceId)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: CORS });
  }
  if (!isClientOwner(context)) {
    return NextResponse.json({ error: "Only owners can update branding" }, { status: 403, headers: CORS });
  }
  const body = await req.json();
  const updateData: Record<string, unknown> = {};
  const fields = ["logo_url","brand_colors","custom_domain","sender_name","sender_email","email_provider","sendgrid_api_key","ses_access_key","ses_secret_key","ses_region","ses_from_email","resend_api_key","twilio_account_sid","twilio_auth_token","twilio_phone_number"];
  for (const f of fields) {
    if (body[f] !== undefined) updateData[f] = body[f];
  }
  const supabaseUrl = process.env.SUPABASE_URL!;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const auth = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, "Content-Type": "application/json", Prefer: "return=representation" };
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/clients?id=eq.${encodeURIComponent(workspaceId)}`, {
      method: "PATCH",
      headers: auth,
      body: JSON.stringify(updateData),
    });
    if (!res.ok) {
      const errText = await res.text();
      if (errText.includes("23505")) {
        return NextResponse.json({ error: "Custom domain already in use" }, { status: 409, headers: CORS });
      }
      return NextResponse.json({ error: "Failed to update branding" }, { status: 500, headers: CORS });
    }
    const data = await res.json();
    return NextResponse.json(data?.[0] || data, { status: 200, headers: CORS });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: CORS });
  }
}
