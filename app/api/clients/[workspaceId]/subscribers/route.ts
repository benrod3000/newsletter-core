import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import {
  getClientContextFromJWT,
  assertWorkspaceAccess,
} from "@/lib/client-context";

/**
 * GET /api/clients/[workspaceId]/subscribers
 * Fetch subscribers for a workspace (JWT authenticated)
 * 
 * Query params:
 * - limit: number (default 100)
 * - offset: number (default 0)
 * - status: "confirmed" | "pending" | "unsubscribed" (optional)
 * 
 * Returns: { subscribers: [...], total: number, limit: number, offset: number }
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  const context = getClientContextFromJWT(req);

  // Verify authentication and workspace access
  if (!context || !assertWorkspaceAccess(context, workspaceId)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "100"), 1000);
  const offset = parseInt(url.searchParams.get("offset") || "0");
  const status = url.searchParams.get("status");

  const supabase = getSupabaseClient();

  try {
    let query = supabase
      .from("subscribers")
      .select("*", { count: "exact" })
      .eq("client_id", workspaceId);

    // Filter by status if provided
    if (status === "confirmed") {
      query = query.eq("confirmed", true);
    } else if (status === "pending") {
      query = query.eq("confirmed", false);
    } else if (status === "unsubscribed") {
      query = query.eq("unsubscribed", true);
    }

    // Paginate
    const { data, count, error } = await query
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error("Subscriber fetch error:", error);
      return NextResponse.json(
        { error: "Failed to fetch subscribers" },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        subscribers: data || [],
        total: count || 0,
        limit,
        offset,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Subscriber endpoint error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/clients/[workspaceId]/subscribers
 * Add a subscriber to the workspace (JWT authenticated)
 * 
 * Body: {
 *   email: string;
 *   first_name?: string;
 *   last_name?: string;
 *   phone_number?: string;
 *   date_of_birth?: string;
 *   country?: string;
 *   region?: string;
 *   city?: string;
 *   latitude?: number;
 *   longitude?: number;
 *   consent_email_marketing?: boolean;
 *   consent_analytics_tracking?: boolean;
 * }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  const context = getClientContextFromJWT(req);

  // Verify authentication and workspace access
  if (!context || !assertWorkspaceAccess(context, workspaceId)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { email, first_name, last_name, phone_number, date_of_birth, country, region, city, latitude, longitude, consent_email_marketing, consent_analytics_tracking } = body;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }

  const supabase = getSupabaseClient();

  try {
    const { data, error } = await supabase
      .from("subscribers")
      .insert({
        client_id: workspaceId,
        email,
        first_name: first_name || null,
        last_name: last_name || null,
        phone_number: phone_number || null,
        date_of_birth: date_of_birth || null,
        country: country || null,
        region: region || null,
        city: city || null,
        latitude: latitude || null,
        longitude: longitude || null,
        consent_email_marketing: consent_email_marketing || false,
        consent_analytics_tracking: consent_analytics_tracking || false,
        confirmed: false,
      })
      .select()
      .single();

    if (error) {
      console.error("Subscriber creation error:", error);
      if (error.code === "23505") {
        // Unique constraint violation
        return NextResponse.json(
          { error: "Subscriber already exists" },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { error: "Failed to create subscriber" },
        { status: 500 }
      );
    }

    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    console.error("Subscriber creation endpoint error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
