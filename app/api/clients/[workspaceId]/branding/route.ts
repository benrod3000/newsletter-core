import { NextRequest } from "next/server";
import {
  getClientContextFromJWT,
  assertWorkspaceAccess,
  isClientOwner,
} from "@/lib/client-context";
import { apiSuccess, apiError, apiUnauthorized, apiForbidden, apiNotFound, apiInternalError } from "@/lib/api-response";

const BRANDING_FIELDS = "id,logo_url,brand_colors,custom_domain,sender_name,sender_email,email_provider,ses_region,ses_from_email,resend_api_key,sendgrid_api_key,fallback_provider,sandbox_mode,twilio_account_sid,twilio_auth_token,twilio_phone_number";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  const context = getClientContextFromJWT(req);
  if (!context || !assertWorkspaceAccess(context, workspaceId)) return apiUnauthorized();

  const supabaseUrl = process.env.SUPABASE_URL!;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const auth = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };
  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/clients?select=${BRANDING_FIELDS}&id=eq.${encodeURIComponent(workspaceId)}&limit=1`,
      { headers: auth }
    );
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return apiNotFound("Workspace");
    return apiSuccess(data[0]);
  } catch {
    return apiInternalError();
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  const context = getClientContextFromJWT(req);
  if (!context || !assertWorkspaceAccess(context, workspaceId)) return apiUnauthorized();
  if (!isClientOwner(context)) return apiForbidden("Only owners can update branding");

  const body = await req.json();
  const updateData: Record<string, unknown> = {};
  const fields = ["logo_url","brand_colors","custom_domain","sender_name","sender_email","email_provider","sendgrid_api_key","resend_api_key","fallback_provider","ses_access_key","ses_secret_key","ses_region","ses_from_email","twilio_account_sid","twilio_auth_token","twilio_phone_number"];
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
      if (errText.includes("23505")) return apiError(409, "CONFLICT", "Custom domain already in use");
      return apiInternalError("Failed to update branding");
    }
    const data = await res.json();
    return apiSuccess(data?.[0] || data);
  } catch {
    return apiInternalError();
  }
}
