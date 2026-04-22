import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import {
  getClientContextFromJWT,
  assertWorkspaceAccess,
  canEditAsClient,
} from "@/lib/client-context";

/**
 * GET /api/clients/[workspaceId]/subscriber-lists
 * Fetch subscriber lists for a workspace (JWT authenticated)
 * 
 * Returns: { lists: [...] }
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
      .from("subscriber_lists")
      .select("*")
      .eq("client_id", workspaceId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Lists fetch error:", error);
      return NextResponse.json(
        { error: "Failed to fetch lists" },
        { status: 500 }
      );
    }

    return NextResponse.json({ lists: data || [] }, { status: 200 });
  } catch (error) {
    console.error("Lists endpoint error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/clients/[workspaceId]/subscriber-lists
 * Create a new subscriber list (JWT authenticated, requires edit permission)
 * 
 * Body: {
 *   name: string;
 *   description?: string;
 *   opt_in_type?: "single" | "double"; // default "single"
 * }
 */
export async function POST(
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
  const { name, description, opt_in_type } = body;

  if (!name) {
    return NextResponse.json({ error: "Name required" }, { status: 400 });
  }

  // Validate opt_in_type
  const validOptInType = ["single", "double"].includes(opt_in_type)
    ? opt_in_type
    : "single";

  const supabase = getSupabaseClient();

  try {
    const { data, error } = await supabase
      .from("subscriber_lists")
      .insert({
        client_id: workspaceId,
        name,
        description: description || null,
        opt_in_type: validOptInType,
      })
      .select()
      .single();

    if (error) {
      console.error("List creation error:", error);
      if (error.code === "23505") {
        // Unique constraint violation
        return NextResponse.json(
          { error: "List with this name already exists" },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { error: "Failed to create list" },
        { status: 500 }
      );
    }

    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    console.error("List creation endpoint error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
