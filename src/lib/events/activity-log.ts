/**
 * Campaign Activity Log — subscribes to domain events and writes
 * a human-readable timeline for every campaign.
 *
 * Like GitHub's commit history. You can replay exactly what happened.
 *
 * Import this file once at startup (e.g., in instrumentation.ts or
 * a top-level layout) to activate all subscriptions.
 */

import { bus, DomainEvent } from "@/lib/events";
import { getSupabaseClient } from "@/lib/supabase";

const ACTIVITY_TABLE = "campaign_activity_log";

// Map event types to human-readable descriptions. Functions receive event data.
const EVENT_LABELS: Record<string, string | ((data: Record<string, unknown>) => string)> = {
  "campaign:created":     "Campaign created",
  "campaign:scheduled":   "Scheduled for delivery",
  "campaign:queued":      "Added to send queue",
  "campaign:preparing":   "Preparing recipients",
  "campaign:sending":     "Sending started",
  "campaign:retrying":    ({ attempt, maxAttempts }) => `Retrying (attempt ${attempt}/${maxAttempts})`,
  "campaign:completed":   ({ sent, failed, durationMs }) =>
    `Send complete — ${sent} sent, ${failed} failed in ${Math.round((durationMs as number) / 1000)}s`,
  "campaign:failed":      ({ error }) => `Send failed: ${(error as any)?.message || "unknown error"}`,
  "campaign:paused":      "Sending paused",
  "campaign:cancelled":   "Campaign cancelled",
  "email:sent":           ({ provider }) => `Sent via ${provider}`,
  "email:failed":         ({ provider, error }) => `Failed via ${provider}: ${(error as any)?.message || "unknown"}`,
  "provider:fallback":    ({ from, to, reason }) => `Fell back from ${from} to ${to} — ${reason || "primary failed"}`,
  "queue:batch_complete": ({ batch, sent, total }) => `Batch ${batch}/${total} complete: ${sent} sent`,
};

function describe(event: DomainEvent): string {
  const label = EVENT_LABELS[event.type];
  if (!label) return event.type;
  if (typeof label === "function") return label(event.data);
  return label;
}

async function writeLog(event: DomainEvent): Promise<void> {
  if (!event.campaignId && !event.workspaceId) return;
  try {
    const supabase = getSupabaseClient();
    await supabase.from(ACTIVITY_TABLE).insert({
      campaign_id: event.campaignId || null,
      workspace_id: event.workspaceId || null,
      event_type: event.type,
      description: describe(event),
      details: event.data,
      subscriber_id: event.subscriberId || null,
      created_at: new Date(event.timestamp).toISOString(),
    });
  } catch (err) {
    console.error("[activity-log] Failed to write entry:", err);
  }
}

// ── Subscribe to campaign lifecycle events ──
const CAMPAIGN_EVENTS = [
  "campaign:created", "campaign:scheduled", "campaign:queued",
  "campaign:preparing", "campaign:sending", "campaign:retrying",
  "campaign:completed", "campaign:failed", "campaign:paused",
  "campaign:cancelled", "email:sent", "email:failed",
  "provider:fallback", "queue:batch_complete",
];

for (const eventType of CAMPAIGN_EVENTS) {
  bus.on(eventType, writeLog);
}

export { describe, writeLog };
