import { NextRequest, NextResponse } from "next/server";
import sgMail from "@sendgrid/mail";
import { getSupabaseClient } from "@/lib/supabase";

type Audience = "all" | "confirmed" | "pending";

function buildHtml(message: string) {
  const escaped = message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="background:#0d0d0d;font-family:sans-serif;margin:0;padding:40px 24px;">
  <table style="max-width:640px;margin:0 auto;width:100%;">
    <tr><td>
      <p style="color:#fbbf24;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;margin:0 0 16px;">
        Newsletter Services
      </p>
      <div style="color:#e4e4e7;font-size:15px;line-height:1.7;white-space:normal;">
        ${escaped}
      </div>
      <hr style="border:none;border-top:1px solid #27272a;margin:32px 0;">
      <p style="color:#71717a;font-size:12px;line-height:1.5;margin:0;">
        You are receiving this email because you subscribed to the newsletter.
      </p>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildHtmlFromEditor(editorHtml: string, editorCss = "") {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  ${editorCss ? `<style>${editorCss}</style>` : ""}
</head>
<body style="background:#0d0d0d;font-family:sans-serif;margin:0;padding:40px 24px;">
  <table style="max-width:640px;margin:0 auto;width:100%;">
    <tr><td>
      <p style="color:#fbbf24;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;margin:0 0 16px;">
        Newsletter Services
      </p>
      <div style="color:#e4e4e7;font-size:15px;line-height:1.7;white-space:normal;">
        ${editorHtml}
      </div>
      <hr style="border:none;border-top:1px solid #27272a;margin:32px 0;">
      <p style="color:#71717a;font-size:12px;line-height:1.5;margin:0;">
        You are receiving this email because you subscribed to the newsletter.
      </p>
    </td></tr>
  </table>
</body>
</html>`;
}

function parseAudience(value: unknown): Audience {
  if (value === "all" || value === "pending") return value;
  return "confirmed";
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body.subject !== "string" || typeof body.message !== "string") {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const subject = body.subject.trim();
    const message = body.message.trim();
    const messageHtml = typeof body.html === "string" ? body.html.trim() : "";
    const messageCss = typeof body.css === "string" ? body.css.trim() : "";
    const audience = parseAudience(body.audience);

    if (!subject || !message) {
      return NextResponse.json({ error: "Subject and message are required." }, { status: 422 });
    }

    const sgApiKey = process.env.SENDGRID_API_KEY;
    const fromEmail = process.env.SENDGRID_FROM_EMAIL;
    if (!sgApiKey || !fromEmail) {
      return NextResponse.json(
        { error: "Missing SENDGRID_API_KEY or SENDGRID_FROM_EMAIL." },
        { status: 500 }
      );
    }

    const supabase = getSupabaseClient();
    let query = supabase.from("subscribers").select("email, confirmed");

    if (audience === "confirmed") query = query.eq("confirmed", true);
    if (audience === "pending") query = query.eq("confirmed", false);

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: `Failed to load subscribers: ${error.message}` }, { status: 500 });
    }

    const recipients = (data ?? [])
      .map((row) => row.email)
      .filter((email): email is string => typeof email === "string" && email.length > 0);

    if (recipients.length === 0) {
      return NextResponse.json({ error: "No matching subscribers to send to." }, { status: 422 });
    }

    if (recipients.length > 300) {
      return NextResponse.json(
        { error: "Too many recipients for one send. Narrow your audience first." },
        { status: 422 }
      );
    }

    sgMail.setApiKey(sgApiKey);
    const html = messageHtml ? buildHtmlFromEditor(messageHtml, messageCss) : buildHtml(message);

    // Send one message per recipient to avoid exposing subscriber emails.
    for (const to of recipients) {
      await sgMail.send({
        to,
        from: fromEmail,
        subject,
        text: message,
        html,
      });
    }

    return NextResponse.json({ ok: true, sentCount: recipients.length });
  } catch (err) {
    console.error("[admin/send] Unexpected error:", err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
