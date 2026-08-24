import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { withWorkspace } from "@/lib/with-workspace";
import { sendEmail, type ProviderConfig } from "@/lib/email-sender";
import { PLATFORM_FALLBACK_FROM_EMAIL } from "@/lib/platform-sender";

/**
 * POST /api/clients/{workspaceId}/test-provider
 * Tests the workspace's email provider by sending a test email to the user.
 */
export const POST = withWorkspace<{ workspaceId: string }>(
  async ({ ctx, params }) => {
  const { workspaceId } = params;

  // Deliberately the service-role client: this reads provider credentials, and
  // migration 049 withholds those columns from `authenticated` so a scoped
  // token cannot see them. Authorization already happened in withWorkspace.
  const supabase = getSupabaseClient();
  const { data: client, error: fetchError } = await supabase
    .from("clients")
    // `from_email` was in this list and has never existed on `clients` - a third
    // phantom column alongside the two that migration 055 adds. Adding the key
    // columns alone would have left this route returning 500 forever.
    .select("email_provider, sendgrid_api_key, ses_access_key, ses_secret_key, ses_region, ses_from_email, resend_api_key, sender_email")
    .eq("id", workspaceId)
    .single();

  if (fetchError || !client) {
    return NextResponse.json({ error: "Could not load workspace settings." }, { status: 500 });
  }

  const provider = client.email_provider || "sendgrid";
  const fromEmail = client.ses_from_email || client.sender_email || PLATFORM_FALLBACK_FROM_EMAIL;

  let config: ProviderConfig;

  if (provider === "ses") {
    if (!client.ses_access_key || !client.ses_secret_key) {
      return NextResponse.json(
        { error: "AWS SES is not configured. Set your Access Key and Secret Key first." },
        { status: 422 }
      );
    }
    config = {
      provider: "ses",
      sesAccessKey: client.ses_access_key,
      sesSecretKey: client.ses_secret_key,
      sesRegion: client.ses_region || "us-east-1",
    };
  } else if (provider === "resend") {
    if (!client.resend_api_key) {
      return NextResponse.json(
        { error: "Resend API key not found. Set it in workspace settings." },
        { status: 422 }
      );
    }
    config = {
      provider: "resend",
      resendApiKey: client.resend_api_key,
    };
  } else {
    if (!client.sendgrid_api_key) {
      return NextResponse.json(
        { error: "SendGrid API key not found. Set it in workspace settings." },
        { status: 422 }
      );
    }
    config = {
      provider: "sendgrid",
      sendgridApiKey: client.sendgrid_api_key,
    };
  }

  try {
    await sendEmail(
      {
        to: ctx.email,
        from: fromEmail,
        subject: "Veloce: Provider Test",
        html: `
          <div style="font-family:system-ui,sans-serif;max-width:480px;margin:40px auto;border:3px solid #0a0a0a;padding:24px">
            <h1 style="font-size:20px;text-transform:uppercase;letter-spacing:0.05em">✅ Provider Test Passed</h1>
            <p style="font-size:14px;color:#555">This email was sent successfully via <strong>${provider === "ses" ? "Amazon SES" : "SendGrid"}</strong>.</p>
            <hr style="border:none;border-top:2px solid #0a0a0a;margin:16px 0" />
            <p style="font-size:12px;color:#888">If you're reading this, your email provider is configured correctly.</p>
          </div>
        `,
      },
      config,
    );

    return NextResponse.json({
      success: true,
      message: `Test email sent to ${ctx.email} via ${provider === "ses" ? "Amazon SES" : provider === "resend" ? "Resend" : "SendGrid"}.`,
      provider,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: `Provider test failed: ${err.message || "Unknown error"}` },
      { status: 500 }
    );
  }
},
  { minRole: "editor" }
);
