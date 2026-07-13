import { NextRequest, NextResponse } from "next/server";
import {
  getClientContextFromJWT,
  assertWorkspaceAccess,
  canEditAsClient,
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

  if (!context || !assertWorkspaceAccess(context, workspaceId)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "100"), 1000);
  const offset = parseInt(url.searchParams.get("offset") || "0");
  const status = url.searchParams.get("status");

  const supabaseUrl = process.env.SUPABASE_URL!;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const auth = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, Accept: "application/json" };

  try {
    let filters = `client_id=eq.${workspaceId}`;
    if (status === "confirmed") filters += `&confirmed=eq.true`;
    else if (status === "pending") filters += `&confirmed=eq.false`;
    else if (status === "unsubscribed") filters += `&unsubscribed=eq.true`;
    else if (status === "active" || status === "at_risk" || status === "cold") filters += `&health_score=eq.${status}`;

    const joinedAfter = url.searchParams.get("joined_after");
    const joinedBefore = url.searchParams.get("joined_before");
    if (joinedAfter) filters += `&created_at=gte.${encodeURIComponent(joinedAfter)}`;
    if (joinedBefore) filters += `&created_at=lte.${encodeURIComponent(joinedBefore + 'T23:59:59')}`;

    const countRes = await fetch(`${supabaseUrl}/rest/v1/subscribers?${filters}&select=count`, { headers: auth });
    const countResult = await countRes.json();
    const total = countResult?.[0]?.count ?? 0;

    const res = await fetch(
      `${supabaseUrl}/rest/v1/subscribers?${filters}&order=created_at.desc&limit=${limit}&offset=${offset}`,
      { headers: auth }
    );

    if (!res.ok) {
      const errText = await res.text();
      console.error("Subscriber fetch error:", res.status, errText);
      return NextResponse.json({ error: "Failed to fetch subscribers" }, { status: 500 });
    }

    const data = await res.json();
    return NextResponse.json({ subscribers: data || [], total, limit, offset }, { status: 200 });
  } catch (error) {
    console.error("Subscriber endpoint error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
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
  const { email, first_name, last_name, phone_number, date_of_birth, country, region, city, latitude, longitude } = body;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL!;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const auth = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, "Content-Type": "application/json", Prefer: "return=representation" };

    const res = await fetch(`${supabaseUrl}/rest/v1/subscribers`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        client_id: workspaceId,
        email: email.toLowerCase().trim(),
        first_name: first_name || null,
        last_name: last_name || null,
        phone_number: phone_number || null,
        date_of_birth: date_of_birth || null,
        country: country || null,
        region: region || null,
        city: city || null,
        latitude: latitude || null,
        longitude: longitude || null,
        confirmed: false,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Subscriber create error:", res.status, errText);
      if (res.status === 409) {
        return NextResponse.json({ error: "Subscriber already exists" }, { status: 409 });
      }
      return NextResponse.json({ error: "Failed to create subscriber" }, { status: 500 });
    }

    const data = await res.json();
    return NextResponse.json(data?.[0] || data, { status: 201 });
  } catch (error) {
    console.error("Subscriber creation endpoint error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/clients/[workspaceId]/subscribers
 * Bulk-delete subscribers by ID. JWT authenticated, requires edit permission.
 *
 * Body: { ids: string[] }
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  const context = getClientContextFromJWT(req);

  if (!context || !assertWorkspaceAccess(context, workspaceId)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!canEditAsClient(context)) {
    return NextResponse.json(
      { error: "Insufficient permissions" },
      { status: 403 }
    );
  }

  const body = await req.json();
  const { ids } = body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json(
      { error: "ids must be a non-empty array" },
      { status: 400 }
    );
  }

  if (ids.length > 500) {
    return NextResponse.json(
      { error: "Maximum 500 subscribers per batch delete" },
      { status: 400 }
    );
  }

  const supabaseUrl = process.env.SUPABASE_URL!;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const auth = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, "Content-Type": "application/json" };

  try {
    const orFilters = ids.map(id => `id.eq.${id}`).join(",");
    const res = await fetch(`${supabaseUrl}/rest/v1/subscribers?or=(${orFilters})&client_id=eq.${workspaceId}`, {
      method: "DELETE",
      headers: auth,
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Bulk subscriber delete error:", res.status, errText);
      return NextResponse.json({ error: "Failed to delete subscribers" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, deleted: ids.length });
  } catch (error) {
    console.error("Bulk delete endpoint error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
