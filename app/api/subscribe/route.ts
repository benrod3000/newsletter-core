import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// Rate limit: max 3 attempts per IP per hour (in-memory, resets on cold start)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  const maxAttempts = 3;
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + windowMs });
    return false;
  }
  if (entry.count >= maxAttempts) return true;
  entry.count++;
  return false;
}

async function getGeoData(ip: string): Promise<{ country: string | null; region: string | null; city: string | null }> {
  if (!ip || ip === "::1" || ip.startsWith("127.") || ip.startsWith("192.168.")) {
    return { country: null, region: null, city: null };
  }
  try {
    const res = await fetch(`https://ipapi.co/${ip}/json/`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return { country: null, region: null, city: null };
    const data = await res.json();
    return {
      country: data.country_code ?? null,
      region: data.region ?? null,
      city: data.city ?? null,
    };
  } catch {
    return { country: null, region: null, city: null };
  }
}

export async function POST(req: NextRequest) {
  try {
    // 1. Parse body
    const body = await req.json().catch(() => null);
    if (!body || typeof body.email !== "string") {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const email = body.email.trim().toLowerCase();

    // 2. Validate email
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Invalid email address." }, { status: 422 });
    }

    // 3. Get IP
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
      req.headers.get("x-real-ip") ||
      "unknown";

    // 4. Rate limit
    if (isRateLimited(ip)) {
      return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });
    }

    // 5. User-Agent (raw)
    const user_agent = req.headers.get("user-agent") ?? null;

    // 6. Geo lookup
    const geo = await getGeoData(ip);

    // 7. Insert into Supabase
    const { error: dbError } = await supabase.from("subscribers").insert([
      {
        email,
        ip,
        country: geo.country,
        region: geo.region,
        city: geo.city,
        user_agent,
      },
    ]);

    if (dbError) {
      // Duplicate email — treat as success so we don't leak existence
      if (dbError.code === "23505") {
        return NextResponse.json({ ok: true }, { status: 200 });
      }
      console.error("[subscribe] Supabase error:", dbError.message);
      return NextResponse.json({ error: "Could not save subscription. Please try again." }, { status: 500 });
    }

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    console.error("[subscribe] Unexpected error:", err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
