/**
 * SandboxTransport - intercepts emails in sandbox mode.
 *
 * Instead of calling a real provider, it simulates delivery
 * and optionally generates synthetic open/click events so
 * analytics populate as if real campaigns were sent.
 */

import type { EmailTransport, SendParams, SendResult, ProviderHealth } from "./transport";
import { getSupabaseClient } from "@/lib/supabase";
import crypto from "crypto";

export class SandboxTransport implements EmailTransport {
  readonly id = "sandbox";
  readonly maxBatchSize = 1000;

  /** Simulate open rate: fraction of emails that "open" */
  private openRate: number;
  /** Simulate click rate: fraction of opens that "click" */
  private clickRate: number;
  /** Workspace and campaign for event generation */
  private campaignId?: string;
  private subscriberId?: string;

  constructor(opts?: { openRate?: number; clickRate?: number; campaignId?: string }) {
    this.openRate = opts?.openRate ?? 0.40;   // 40% open rate
    this.clickRate = opts?.clickRate ?? 0.15;  // 15% click rate
    this.campaignId = opts?.campaignId;
  }

  async send(params: SendParams): Promise<SendResult> {
    const messageId = `sandbox_${crypto.randomUUID()}`;

    // Generate synthetic open/click events for analytics. workspaceId is
    // required now that campaign_events.workspace_id is NOT NULL (migration
    // 048); without it there is nothing to attribute the events to, so skip
    // rather than write rows that cannot be isolated.
    if (params.campaignId && params.subscriberId && params.workspaceId) {
      await this.generateSyntheticEvents(
        params.campaignId,
        params.subscriberId,
        params.to,
        params.workspaceId
      );
    }

    console.log(`[sandbox] Simulated send to ${params.to}: ${params.subject}`);

    return {
      success: true,
      messageId,
      statusCode: 200,
    };
  }

  private async generateSyntheticEvents(
    campaignId: string,
    subscriberId: string,
    email: string,
    workspaceId: string
  ): Promise<void> {
    try {
      const supabase = getSupabaseClient();
      const now = new Date();

      // Simulate open (40% chance)
      if (Math.random() < this.openRate) {
        const openTime = new Date(now.getTime() + Math.random() * 3600000); // within 1 hour
        await supabase.from("campaign_events").insert({
          campaign_id: campaignId,
          subscriber_id: subscriberId,
          workspace_id: workspaceId,
          email,
          event_type: "open",
          occurred_at: openTime.toISOString(),
        });

        // Simulate click (15% of opens)
        if (Math.random() < this.clickRate) {
          const clickTime = new Date(openTime.getTime() + Math.random() * 600000); // within 10 min of open
          await supabase.from("campaign_events").insert({
            campaign_id: campaignId,
            subscriber_id: subscriberId,
            workspace_id: workspaceId,
            email,
            event_type: "click",
            occurred_at: clickTime.toISOString(),
            url: "https://veloce.app/sandbox",
          });
        }
      }
    } catch (err) {
      console.error("[sandbox] Failed to generate synthetic events:", err);
    }
  }

  async health(): Promise<ProviderHealth> {
    return { healthy: true, lastChecked: Date.now() };
  }
}
