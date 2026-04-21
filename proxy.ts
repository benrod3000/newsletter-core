import { NextRequest, NextResponse } from "next/server";

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

  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
