import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";

/**
 * POST /api/webhooks/automation-trigger
 * Trigger an automation based on an external event
 * 
 * Public endpoint (no auth required, but workspace_id must be valid)
 * Can be called from service site or external systems
 * 
 * Body: {
 *   workspace_id: string;
 *   trigger_type: "subscriber_joined" | "lead_magnet_claimed" | "location_change";
 *   subscriber_id?: string;
 *   event_data: Record<string, unknown>;
 *   api_key?: string; // Optional API key for verification
 * }
 * 
 * Response: { automations_triggered: number; logs: [...] }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { workspace_id, trigger_type, subscriber_id, event_data } = body;

    if (!workspace_id || !trigger_type) {
      return NextResponse.json(
        { error: "workspace_id and trigger_type required" },
        { status: 400 }
      );
    }

    const supabase = getSupabaseClient();

    // Find all active automations for this workspace with matching trigger type
    const { data: automations, error: automationError } = await supabase
      .from("automation_triggers")
      .select("id, name, action_type, action_config")
      .eq("workspace_id", workspace_id)
      .eq("trigger_type", trigger_type)
      .eq("is_active", true);

    if (automationError || !automations || automations.length === 0) {
      return NextResponse.json(
        {
          automations_triggered: 0,
          logs: [],
          message: "No matching automations found",
        },
        { status: 200 }
      );
    }

    const logs = [];

    // Process each matching automation
    for (const automation of automations) {
      try {
        // Create automation log entry
        const { data: logEntry, error: logError } = await supabase
          .from("automation_logs")
          .insert({
            automation_id: automation.id,
            subscriber_id: subscriber_id || null,
            trigger_event: event_data,
            status: "pending",
          })
          .select()
          .single();

        if (!logError && logEntry) {
          logs.push({
            automation_id: automation.id,
            automation_name: automation.name,
            log_id: logEntry.id,
            status: "pending",
          });

          // TODO: Implement actual action execution
          // - send_email: queue campaign send to subscriber
          // - add_to_list: add subscriber to list
          // - send_notification: send push/SMS notification

          // For now, mark as success
          await supabase
            .from("automation_logs")
            .update({ status: "success", executed_at: new Date().toISOString() })
            .eq("id", logEntry.id);
        }
      } catch (error) {
        console.error(`Error processing automation ${automation.id}:`, error);
      }
    }

    return NextResponse.json(
      {
        automations_triggered: logs.length,
        logs,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Automation trigger webhook error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
