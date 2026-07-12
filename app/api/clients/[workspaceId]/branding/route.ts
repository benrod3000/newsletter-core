import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import {
  getClientContextFromJWT,
  assertWorkspaceAccess,
  isClientOwner,
} from "@/lib/client-context";

/**
 * GET /api/clients/[workspaceId]/branding
 * Fetch workspace branding settings (JWT authenticated)
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  const context = getClientContextFromJWT(req);

  if (!context || !assertWorkspaceAccess(context, workspaceId)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseClient();

  try {
    const { data, error } = await supabase
      .from("clients")
      .select(
        "id, logo_url, brand_colors, custom_domain, sender_name, sender_email, email_provider, ses_region, ses_from_email"
      )
      .eq("id", workspaceId)
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: "Workspace not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    console.error("Branding fetch error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/clients/[workspaceId]/branding
 * Update workspace branding (JWT authenticated, owner only)
 * 
 * Body: {
 *   logo_url?: string;
 *   brand_colors?: { primary: string; secondary: string; };
 *   custom_domain?: string;
 *   sender_name?: string;
 *   sender_email?: string;
 *   email_provider?: "sendgrid" | "ses";
 *   ses_access_key?: string;
 *   ses_secret_key?: string;
 *   ses_region?: string;
 *   ses_from_email?: string;
 * }
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  const context = getClientContextFromJWT(req);

  if (!context || !assertWorkspaceAccess(context, workspaceId)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Only workspace owners can update branding
  if (!isClientOwner(context)) {
    return NextResponse.json(
      { error: "Insufficient permissions. Only workspace owners can update branding." },
      { status: 403 }
    );
  }

  const body = await req.json();
  const {
    logo_url,
    brand_colors,
    custom_domain,
    sender_name,
    sender_email,
    email_provider,
    ses_access_key,
    ses_secret_key,
    ses_region,
    ses_from_email,
  } = body;

  const supabase = getSupabaseClient();

  try {
    // Prepare update data
    const updateData: Record<string, unknown> = {};
    if (logo_url !== undefined) updateData.logo_url = logo_url;
    if (brand_colors !== undefined) updateData.brand_colors = brand_colors;
    if (custom_domain !== undefined) updateData.custom_domain = custom_domain;
    if (sender_name !== undefined) updateData.sender_name = sender_name;
    if (sender_email !== undefined) updateData.sender_email = sender_email;
    if (email_provider !== undefined) updateData.email_provider = email_provider;
    if (ses_access_key !== undefined) updateData.ses_access_key = ses_access_key;
    if (ses_secret_key !== undefined) updateData.ses_secret_key = ses_secret_key;
    if (ses_region !== undefined) updateData.ses_region = ses_region;
    if (ses_from_email !== undefined) updateData.ses_from_email = ses_from_email;

    const { data, error } = await supabase
      .from("clients")
      .update(updateData)
      .eq("id", workspaceId)
      .select(
        "id, logo_url, brand_colors, custom_domain, sender_name, sender_email, email_provider, ses_region, ses_from_email"
      )
      .single();

    if (error) {
      console.error("Branding update error:", error);
      // Handle unique constraint on custom_domain
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "Custom domain already in use" },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { error: "Failed to update branding" },
        { status: 500 }
      );
    }

    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    console.error("Branding update endpoint error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
