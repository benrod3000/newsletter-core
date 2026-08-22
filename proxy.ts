import { NextRequest, NextResponse } from "next/server";
import { signAdminHeaders } from "@/lib/admin-context";
import { isCronPath } from "@/lib/cron-paths";

const ALLOWED_ORIGINS = [
  "https://newsletter.brod3000.com",
  "http://localhost:5173",
  "http://localhost:4173",
  "https://newsletter-core.vercel.app",
];

function getCorsOrigin(request: NextRequest): string {
  const origin = request.headers.get("origin");
  if (origin && ALLOWED_ORIGINS.includes(origin)) return origin;
  return "https://newsletter.brod3000.com";
}

function unauthorizedResponse() {
  return new NextResponse("Authentication required.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Newsletter Admin", charset="UTF-8"',
    },
  });
}

function decodeBasicCredentials(encodedCredentials: string) {
  try {
    if (typeof atob === "function") {
      return atob(encodedCredentials);
    }
  } catch {
    // no-op: fallback below
  }

  try {
    return Buffer.from(encodedCredentials, "base64").toString("utf-8");
  } catch {
    return null;
  }
}

async function authenticateFromSupabase(username: string, password: string) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return null;
  }

  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/auth_admin_login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify({
        p_username: username,
        p_password: password,
      }),
      cache: "no-store",
    });

    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    if (!data) return null;

    const row = Array.isArray(data) ? data[0] : data;
    if (!row || !row.username || !row.role) return null;

    return {
      username: String(row.username),
      role: String(row.role),
      clientId: row.client_id ? String(row.client_id) : "",
    };
  } catch {
    return null;
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = new URL(request.url);
  const requestId = crypto.randomUUID();

  // Handle CORS preflight for ALL routes
  if (request.method === "OPTIONS") {
    const origin = getCorsOrigin(request);
    return new NextResponse(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type, x-admin-role, x-admin-username, x-admin-client-id",
        "Access-Control-Max-Age": "86400",
        "Vary": "Origin",
        "X-Request-Id": requestId,
      },
    });
  }

  // Only require Basic Auth for admin routes; let API routes pass through.
  //
  // Cron endpoints are exempt from *Basic* auth because a scheduler sends
  // `Authorization: Bearer <CRON_SECRET>`, which this middleware would reject
  // before the handler could check it. They are not unauthenticated: each one
  // calls requireCronSecret() first thing.
  //
  // The list lives in one place now. It was three inline conditions here, and
  // /api/admin/campaigns/recover was missing from them - so the cron that
  // finishes interrupted sends was answered with a Basic-Auth challenge and had
  // never once run. A cron that 401s looks exactly like a cron with no work.
  const isAdminRoute = pathname.startsWith("/admin") || pathname.startsWith("/api/admin");
  if (!isAdminRoute || isCronPath(pathname)) {
    const response = NextResponse.next();
    response.headers.set("Access-Control-Allow-Origin", getCorsOrigin(request));
    response.headers.set("Vary", "Origin");
    response.headers.set("X-Request-Id", requestId);
    return response;
  }

  const adminUser = process.env.ADMIN_USERNAME;
  const adminPass = process.env.ADMIN_PASSWORD;

  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Basic ")) {
    return unauthorizedResponse();
  }

  const encodedCredentials = authHeader.slice("Basic ".length).trim();
  const decodedCredentials = decodeBasicCredentials(encodedCredentials);
  if (!decodedCredentials) {
    return unauthorizedResponse();
  }

  const separatorIndex = decodedCredentials.indexOf(":");
  if (separatorIndex < 0) {
    return unauthorizedResponse();
  }

  const username = decodedCredentials.slice(0, separatorIndex);
  const password = decodedCredentials.slice(separatorIndex + 1);

  const requestHeaders = new Headers(request.headers);

  // Backward-compatible owner credentials from environment variables.
  if (adminUser && adminPass && username === adminUser && password === adminPass) {
    requestHeaders.set("x-admin-username", username);
    requestHeaders.set("x-admin-role", "owner");
    requestHeaders.delete("x-admin-client-id");
    requestHeaders.set("x-admin-signature", signAdminHeaders(`${username}:owner:`));
    return NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
  }

  // Multi-user auth from Supabase table.
  const authenticated = await authenticateFromSupabase(username, password);
  if (!authenticated) {
    return unauthorizedResponse();
  }

  requestHeaders.set("x-admin-username", authenticated.username);
  requestHeaders.set("x-admin-role", authenticated.role);
  if (authenticated.clientId) {
    requestHeaders.set("x-admin-client-id", authenticated.clientId);
  } else {
    requestHeaders.delete("x-admin-client-id");
  }
  requestHeaders.set("x-admin-signature", signAdminHeaders(`${authenticated.username}:${authenticated.role}:${authenticated.clientId || ""}`));

  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
}

export const config = {
  matcher: ["/:path*"],
};
