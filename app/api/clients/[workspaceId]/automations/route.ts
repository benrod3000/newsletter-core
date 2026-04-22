import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import {
  getClientContextFromJWT,
  assertWorkspaceAccess,
  canEditAsClient,
} from "@/lib/client-context";

/**
 * GET /api/clients/[workspaceId]/automations
 * Fetch automation triggers for a workspace (JWT authenticated)
 * 
 * Query params:
 * - limit: number (default 50)
 * - offset: number (default 0)
 * 
 * Returns: { automations: [...], total: number }
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
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 500);
  const offset = parseInt(url.searchParams.get("offset") || "0");

  const supabase = getSupabaseClient();

  try {
    const { data, count, error } = await supabase
      .from("automation_triggers")
      .select("*", { count: "exact" })
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error("Automations fetch error:", error);
      return NextResponse.json(
        { error: "Failed to fetch automations" },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        automations: data || [],
        total: count || 0,
        limit,
        offset,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Automations endpoint error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/clients/[workspaceId]/automations
 * Create a new automation trigger (JWT authenticated, requires edit permission)
 * 
 * Body: {
 *   name: string;
 *   description?: string;
 *   trigger_type: "subscriber_joined" | "lead_magnet_claimed" | "location_change" | "custom_webhook" | "on_schedule";
 *   trigger_config: Record<string, unknown>; // trigger-specific
 *   action_type: "send_email" | "add_to_list" | "send_notification";
 *   action_config: Record<string, unknown>; // { campaign_id?: string; list_id?: string; }
 *   is_active?: boolean;
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
  const {
    name,
    description,
    trigger_type,
    trigger_config,
    action_type,
    action_config,
    is_active = true,
  } = body;

  if (!name || !trigger_type || !action_type) {
    return NextResponse.json(
      { error: "name, trigger_type, and action_type required" },
      { status: 400 }
    );
  }

  const supabase = getSupabaseClient();

  try {
    const { data, error } = await supabase
      .from("automation_triggers")
      .insert({
        workspace_id: workspaceId,
        name,
        description: description || null,
        trigger_type,
        trigger_config: trigger_config || {},
        action_type,
        action_config: action_config || {},
        is_active,
        created_by: context.userId,
      })
      .select()
      .single();

    if (error) {
      console.error("Automation creation error:", error);
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "Automation with this name already exists" },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { error: "Failed to create automation" },
        { status: 500 }
      );
    }

    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    console.error("Automation creation endpoint error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
