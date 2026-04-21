import { NextRequest, NextResponse } from "next/server";
import sgMail from "@sendgrid/mail";
import { getSupabaseClient } from "@/lib/supabase";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Handle preflight requests
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

// Durable rate limit: max 3 attempts per IP per hour (stored in DB)
async function isRateLimited(ip: string): Promise<boolean> {
  if (!ip || ip === "unknown") return false;

  const supabase = getSupabaseClient();
  const windowStart = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const maxAttempts = 3;

  const { count, error } = await supabase
    .from("subscribe_attempts")
    .select("id", { count: "exact", head: true })
    .eq("ip", ip)
    .gte("created_at", windowStart);

  if (error) {
    console.error("[subscribe] Rate-limit check error:", error.message);
    return false;
  }

  return (count ?? 0) >= maxAttempts;
}

async function logSubscribeAttempt(ip: string, email: string) {
  if (!ip || ip === "unknown") return;

  const supabase = getSupabaseClient();
  const { error } = await supabase.from("subscribe_attempts").insert([{ ip, email }]);

  if (error) {
    console.error("[subscribe] Rate-limit log error:", error.message);
  }
}

function parseCoordinate(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getGeoData(req: NextRequest): {
  country: string | null;
  region: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
} {
  return {
    country: req.headers.get("x-vercel-ip-country") ?? null,
    region: req.headers.get("x-vercel-ip-country-region") ?? null,
    city: req.headers.get("x-vercel-ip-city") ?? null,
    latitude: parseCoordinate(req.headers.get("x-vercel-ip-latitude")),
    longitude: parseCoordinate(req.headers.get("x-vercel-ip-longitude")),
  };
}

function cleanText(value: unknown, maxLength = 200): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

async function resolveClientIdForSignup(supabase: ReturnType<typeof getSupabaseClient>, clientSlug: string | null) {
  const slug = clientSlug || process.env.DEFAULT_CLIENT_SLUG || "default";

  const { data } = await supabase
    .from("clients")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();

  if (data?.id) return data.id;

  const { data: fallback } = await supabase
    .from("clients")
    .select("id")
    .eq("slug", "default")
    .maybeSingle();

  return fallback?.id ?? null;
}

async function sendConfirmationEmail({
  email,
  confirmationToken,
  unsubscribeToken,
  host,
}: {
  email: string;
  confirmationToken: string;
  unsubscribeToken: string;
  host: string | null;
}): Promise<{ sent: boolean; reason?: string }> {
  const sgApiKey = process.env.SENDGRID_API_KEY;
  const fromEmail = process.env.SENDGRID_FROM_EMAIL;
  const appUrl = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? `https://${host}`;

  if (!sgApiKey || !fromEmail) {
    console.error("[subscribe] Missing SENDGRID_API_KEY or SENDGRID_FROM_EMAIL.");
    return { sent: false, reason: "Email service is not configured." };
  }

  try {
    sgMail.setApiKey(sgApiKey);
    const confirmUrl = `${appUrl}/api/confirm?token=${confirmationToken}`;
    const unsubscribeUrl = `${appUrl}/unsubscribe?token=${unsubscribeToken}`;

    await sgMail.send({
      to: email,
      from: fromEmail,
      subject: "Confirm your subscription",
      html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="background:#0d0d0d;font-family:sans-serif;margin:0;padding:40px 24px;">
  <table style="max-width:520px;margin:0 auto;width:100%;">
    <tr><td>
      <p style="color:#fbbf24;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;margin:0 0 16px;">
        Newsletter Services
      </p>
      <h1 style="color:#fff;font-size:32px;font-weight:700;margin:0 0 16px;line-height:1.2;">
        One click to confirm.
      </h1>
      <p style="color:#a1a1aa;font-size:15px;line-height:1.6;margin:0 0 32px;">
        You signed up for <strong style="color:#fff;">Attention → Ownership</strong>.
        Hit the button below to confirm and you&rsquo;re in.
      </p>
      <a href="${confirmUrl}"
         style="display:inline-block;background:#fbbf24;color:#000;font-size:14px;font-weight:700;padding:14px 28px;border-radius:8px;text-decoration:none;">
        Confirm my subscription
      </a>
      <hr style="border:none;border-top:1px solid #27272a;margin:40px 0;">
      <p style="color:#52525b;font-size:12px;line-height:1.5;margin:0;">
        If you didn&rsquo;t sign up for this, you can safely ignore this email.<br>
        <a href="${unsubscribeUrl}" style="color:#52525b;">Unsubscribe</a>
      </p>
    </td></tr>
  </table>
</body>
</html>`,
      text: `Confirm your subscription to Attention → Ownership.\n\nVisit this link to confirm:\n${confirmUrl}\n\nIf you didn't sign up, ignore this email.\nUnsubscribe: ${unsubscribeUrl}`,
    });

    return { sent: true };
  } catch (emailErr) {
    console.error("[subscribe] SendGrid error:", emailErr);
    return { sent: false, reason: "Email provider rejected the send request." };
  }
}

export async function POST(req: NextRequest) {
  try {
    // 1. Parse body
    const body = await req.json().catch(() => null);
    if (!body || typeof body.email !== "string") {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400, headers: CORS_HEADERS });
    }

    // Honeypot: if this hidden field is filled, silently accept and drop.
    if (typeof body.company === "string" && body.company.trim().length > 0) {
      return NextResponse.json({ ok: true }, { status: 200, headers: CORS_HEADERS });
    }

    const email = body.email.trim().toLowerCase();
    const timezone = cleanText(body.timezone, 100);
    const locale = cleanText(body.locale, 50);
    const utm_source = cleanText(body.utm_source, 120);
    const utm_medium = cleanText(body.utm_medium, 120);
    const utm_campaign = cleanText(body.utm_campaign, 160);
    const referrer = cleanText(body.referrer, 500);
    const landing_path = cleanText(body.landing_path, 300);
    const client_slug = cleanText(body.client_slug, 80);

    // 2. Validate email
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Invalid email address." }, { status: 422, headers: CORS_HEADERS });
    }

    // 3. Get IP
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
      req.headers.get("x-real-ip") ||
      "unknown";

    // 4. Rate limit
    if (await isRateLimited(ip)) {
      return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429, headers: CORS_HEADERS });
    }

    await logSubscribeAttempt(ip, email);

    // 5. User-Agent (raw)
    const user_agent = req.headers.get("user-agent") ?? null;

    // 6. Geo lookup (Vercel headers)
    const geo = getGeoData(req);

    // 7. Insert into Supabase, returning tokens for the email
    const supabase = getSupabaseClient();
    const client_id = await resolveClientIdForSignup(supabase, client_slug);
    const { data: subscriber, error: dbError } = await supabase
      .from("subscribers")
      .insert([
        {
          client_id,
          email,
          ip,
          country: geo.country,
          region: geo.region,
          city: geo.city,
          latitude: geo.latitude,
          longitude: geo.longitude,
          user_agent,
          timezone,
          locale,
          utm_source,
          utm_medium,
          utm_campaign,
          referrer,
          landing_path,
          created_at: new Date().toISOString(),
        },
      ])
      .select("confirmation_token, unsubscribe_token")
      .single();

    if (dbError) {
      if (dbError.code === "23505") {
        const { data: existing, error: existingError } = await supabase
          .from("subscribers")
          .select("confirmed, confirmation_token, unsubscribe_token")
          .eq("email", email)
          .maybeSingle();

        if (existingError || !existing) {
          console.error("[subscribe] Duplicate lookup error:", existingError?.message);
          return NextResponse.json({ ok: true }, { status: 200, headers: CORS_HEADERS });
        }

        if (existing.confirmed) {
          return NextResponse.json({ ok: true, alreadyConfirmed: true }, { status: 200, headers: CORS_HEADERS });
        }

        const resendResult = await sendConfirmationEmail({
          email,
          confirmationToken: existing.confirmation_token,
          unsubscribeToken: existing.unsubscribe_token,
          host: req.headers.get("host"),
        });

        if (!resendResult.sent) {
          return NextResponse.json(
            {
              ok: true,
              emailSent: false,
              warning: "We saved your signup, but could not send the confirmation email right now.",
              reason: resendResult.reason,
            },
            { status: 202, headers: CORS_HEADERS }
          );
        }

        return NextResponse.json({ ok: true, emailSent: true, resent: true }, { status: 200, headers: CORS_HEADERS });
      }
      console.error("[subscribe] Supabase error:", dbError.message);
      return NextResponse.json({ error: "Could not save subscription. Please try again." }, { status: 500, headers: CORS_HEADERS });
    }

    if (!subscriber) {
      return NextResponse.json({ error: "Could not save subscription. Please try again." }, { status: 500, headers: CORS_HEADERS });
    }

    const emailResult = await sendConfirmationEmail({
      email,
      confirmationToken: subscriber.confirmation_token,
      unsubscribeToken: subscriber.unsubscribe_token,
      host: req.headers.get("host"),
    });

    if (!emailResult.sent) {
      return NextResponse.json(
        {
          ok: true,
          emailSent: false,
          warning: "We saved your signup, but could not send the confirmation email right now.",
          reason: emailResult.reason,
        },
        { status: 202, headers: CORS_HEADERS }
      );
    }

    return NextResponse.json({ ok: true, emailSent: true }, { status: 201, headers: CORS_HEADERS });
  } catch (err) {
    console.error("[subscribe] Unexpected error:", err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500, headers: CORS_HEADERS });
  }
}
