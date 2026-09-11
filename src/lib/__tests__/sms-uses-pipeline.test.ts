import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * SMS must go through the durable queue, not a loop in a request handler.
 *
 * This is a structural test over source text, which is unusual but is the only
 * thing that can catch the regression it guards. The failure mode is not a wrong
 * value: it is someone adding a "quick" direct Twilio call back into a route
 * because the pipeline felt like too much ceremony for one message. Every unit
 * test would still pass, and the loss - no per-recipient state, no idempotency,
 * no send-time consent recheck, no recovery - is invisible until a function
 * times out mid-send and a retry texts several thousand people twice.
 *
 * Same technique as `audience-values.test.ts`, which reads a type out of source
 * for the same reason: some invariants only exist in the shape of the code.
 */

const ROOT = process.cwd();
const SMS_ROUTE = "app/api/clients/[workspaceId]/campaigns/sms/route.ts";

function source(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

/** Strip comments, so prose describing the old code does not fail the test. */
function code(rel: string): string {
  return source(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("the SMS campaign route", () => {
  it("enqueues through the shared send path", () => {
    expect(code(SMS_ROUTE)).toMatch(/sendCampaignBlast\(/);
  });

  it("queues with channel sms, so the audience and claim use SMS consent", () => {
    // Without this the job defaults to email: campaign_audience() would select
    // people by email consent and text them, and claim_campaign_recipients()
    // would retire everyone lacking email consent as permanently failed.
    expect(code(SMS_ROUTE)).toMatch(/channel:\s*["']sms["']/);
  });

  it("does not call Twilio directly", () => {
    // The route's job is to queue. Only the transport talks to a carrier.
    expect(code(SMS_ROUTE)).not.toMatch(/api\.twilio\.com/);
    expect(code(SMS_ROUTE)).not.toMatch(/Messages\.json/);
  });

  it("does not hand-roll merge tags", () => {
    // The old loop did two .replace() calls for first_name and name, so every
    // other tag the composer offered arrived literally, as {{city}}, to a real
    // person. buildRecipientSms owns this now.
    expect(code(SMS_ROUTE)).not.toMatch(/\{\{\s*first_name\s*\}\}/);
  });

  it("does not truncate the body", () => {
    // `.slice(0, 1600)` silently rewrote the author's message mid-sentence after
    // the operator had already been shown a recipient count.
    expect(code(SMS_ROUTE)).not.toMatch(/\.slice\(0,\s*1600\)/);
  });

  it("counts recipients with the shared predicate, not its own filter list", () => {
    // The count and the send were two hand-written PostgREST queries and had
    // already drifted: the count omitted the "has a phone number" filter the
    // send applied, so the operator was shown more people than would be texted.
    expect(code(SMS_ROUTE)).toMatch(/count_campaign_recipients/);
    expect(code(SMS_ROUTE)).not.toMatch(/sms_consent=is\.true/);
  });

  it("makes no claim about RCS", () => {
    // The route used to promise rich messaging on Android with a fallback on
    // iOS, while attaching MediaUrl to an ordinary message - which is MMS. Real
    // RCS needs a Google RBM agent, brand verification and carrier approval.
    //
    // Comments are stripped first: describing the removed claim is fine, shipping
    // it in a response body is not.
    expect(code(SMS_ROUTE)).not.toMatch(/RCS on Android/);
  });
});

describe("the send queue", () => {
  const QUEUE = "src/lib/send-queue.ts";

  it("passes the channel into the claim", () => {
    // The claim re-checks opt-out at dispatch time against the consent column
    // for that channel. Omitting it is silently destructive on an SMS job.
    expect(code(QUEUE)).toMatch(/claim_campaign_recipients[\s\S]{0,160}p_channel/);
  });

  it("passes the channel into the enqueue", () => {
    expect(code(QUEUE)).toMatch(/enqueue_campaign_recipients[\s\S]{0,800}p_channel/);
  });

  it("retries SMS rather than dropping the first failure", () => {
    // The whole reason SMS moved onto this queue. The replaced code caught every
    // failure into failed++ and retried none, so a rate limit that clears in a
    // second was as fatal as an invalid number.
    expect(code(QUEUE)).toMatch(/sendSmsWithRetry/);
  });
});

describe("the recovery cron", () => {
  const RECOVER = "app/api/admin/campaigns/recover/route.ts";

  it("reads the channel from the job, not the campaign", () => {
    // campaign_jobs.channel is denormalized precisely so recovery, which runs
    // hours or days later, cannot have a since-edited campaign decide how
    // already-queued recipients are sent.
    expect(code(RECOVER)).toMatch(/job\.channel/);
    expect(code(RECOVER)).not.toMatch(/campaign\.channel/);
  });

  it("selects the channel when listing unfinished jobs", () => {
    expect(code(RECOVER)).toMatch(/\.select\([^)]*channel[^)]*\)/);
  });
});
