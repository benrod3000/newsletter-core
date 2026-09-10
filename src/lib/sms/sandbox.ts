import type { SmsTransport, SmsSendParams } from "./transport";
import type { SendResult, ProviderHealth } from "../messaging/result";
import { getSupabaseClient } from "@/lib/supabase";
import crypto from "crypto";

/**
 * SMS sandbox: exercises the whole pipeline without a provider.
 *
 * This is not a convenience. There is no Twilio account on this project yet, and
 * US A2P traffic needs 10DLC registration before carriers deliver it reliably,
 * which is an approval process measured in weeks. Without this transport the
 * entire SMS path - enqueue, claim, retry, recovery, event recording, the
 * consent recheck - would ship having never once been executed, and this project
 * has already learned twice what that costs. `seed_demo_data` was declared fixed
 * from reading it and had two faults upstream of the one that reading found.
 *
 * So: the queue runs for real, the events are real rows, and only the carrier is
 * absent.
 *
 * It deliberately does NOT invent opens and clicks the way the email sandbox
 * does. SMS has no open tracking at all - no pixel, nothing to instrument - so
 * synthesizing engagement would put numbers on the dashboard that the real
 * channel can never produce, and someone would later build a feature on them.
 * The one real SMS event is that it was sent.
 */
export class SmsSandboxTransport implements SmsTransport {
  readonly id = "sandbox";

  /**
   * No provider, no rate limit. Set high so a sandbox drain finishes at the
   * speed of the database rather than pretending to be a long code, which would
   * make a 10,000 recipient verification run take three hours for no reason.
   */
  readonly messagesPerSecond = 100;

  async send(params: SmsSendParams): Promise<SendResult> {
    const messageId = `sandbox_sms_${crypto.randomUUID()}`;

    if (params.campaignId && params.subscriberId && params.workspaceId) {
      await this.recordSent(params);
    }

    console.log(`[sms-sandbox] Simulated send to ${params.to}: ${params.body.slice(0, 60)}`);

    return { success: true, messageId, statusCode: 200 };
  }

  private async recordSent(params: SmsSendParams): Promise<void> {
    const supabase = getSupabaseClient();
    const { error } = await supabase.from("campaign_events").insert({
      campaign_id: params.campaignId!,
      subscriber_id: params.subscriberId!,
      workspace_id: params.workspaceId!,
      // Null, not the phone number. `campaign_events.email` became nullable in
      // migration 073 precisely so a non-email channel would not have to lie
      // about what it is putting there.
      email: null,
      channel: "sms",
      event_type: "sent",
    });

    // supabase-js resolves errors rather than throwing, so without this check a
    // failed insert would leave the sandbox reporting a clean run over an empty
    // events table - which is exactly the outcome this transport exists to rule
    // out.
    if (error) {
      console.error("[sms-sandbox] Failed to record sent event:", error.message);
    }
  }

  async health(): Promise<ProviderHealth> {
    return { healthy: true, lastChecked: Date.now() };
  }
}
