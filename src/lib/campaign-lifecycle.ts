/**
 * Campaign Lifecycle State Machine.
 *
 * Defines valid states and transitions for campaigns.
 * Every state change emits a domain event via the EventBus,
 * which the activity log subscriber captures.
 *
 * States:
 *   draft     — being edited, not yet ready
 *   scheduled — queued for future delivery
 *   queued    — in the send queue, waiting for processing
 *   preparing — resolving recipients, building email content
 *   sending   — actively dispatching to recipients
 *   retrying  — transient failure, will retry
 *   paused    — manually paused mid-send (future)
 *   completed — all recipients processed (may have partial failures)
 *   failed    — all recipients failed or permanent error
 *   cancelled — manually cancelled before sending
 */

export type CampaignStatus =
  | "draft"
  | "scheduled"
  | "queued"
  | "preparing"
  | "sending"
  | "retrying"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled"
  | "sent"; // legacy alias for "completed"

/** Valid transitions from each state */
const TRANSITIONS: Record<CampaignStatus, CampaignStatus[]> = {
  draft:     ["scheduled", "cancelled"],
  scheduled: ["queued", "cancelled"],
  queued:    ["preparing", "cancelled", "failed"],
  preparing: ["sending", "failed", "cancelled"],
  sending:   ["retrying", "completed", "sent", "failed", "paused"],
  retrying:  ["sending", "completed", "sent", "failed"],
  paused:    ["sending", "cancelled"],
  completed: [],  // terminal
  sent:      [],  // terminal (legacy)
  failed:    [],  // terminal
  cancelled: [],  // terminal
};

/** Human-readable labels for UI display */
export const STATUS_LABELS: Record<CampaignStatus, string> = {
  draft:     "Draft",
  scheduled: "Scheduled",
  queued:    "Queued",
  preparing: "Preparing",
  sending:   "Sending",
  retrying:  "Retrying",
  paused:    "Paused",
  completed: "Sent",
  sent:      "Sent",
  failed:    "Failed",
  cancelled: "Cancelled",
};

/** Statuses that indicate the campaign is actively processing */
export const ACTIVE_STATUSES: CampaignStatus[] = ["queued", "preparing", "sending", "retrying", "paused"];

/** Statuses that are terminal (no further transitions) */
export const TERMINAL_STATUSES: CampaignStatus[] = ["completed", "failed", "cancelled"];

/**
 * Validate a state transition. Returns true if the transition is allowed.
 */
export function canTransition(from: CampaignStatus, to: CampaignStatus): boolean {
  const allowed = TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

/**
 * Transition a campaign to a new status. Throws if the transition is invalid.
 * Use this as the single source of truth for all status changes.
 */
export function transition(from: CampaignStatus, to: CampaignStatus): CampaignStatus {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid campaign transition: ${from} → ${to}`);
  }
  return to;
}
