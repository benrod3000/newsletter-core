import { NextRequest, NextResponse } from "next/server";

function unauthorizedResponse() {
  return new NextResponse("Authentication required.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Newsletter Admin", charset="UTF-8"',
    },
  });
}

export function proxy(request: NextRequest) {
  const adminUser = process.env.ADMIN_USERNAME;
  const adminPass = process.env.ADMIN_PASSWORD;

  if (!adminUser || !adminPass) {
    return new NextResponse("Admin credentials are not configured.", { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Basic ")) {
    return unauthorizedResponse();
  }

  const encodedCredentials = authHeader.slice("Basic ".length).trim();
  let decodedCredentials = "";

  try {
    decodedCredentials = Buffer.from(encodedCredentials, "base64").toString("utf-8");
  } catch {
    return unauthorizedResponse();
  }

  const separatorIndex = decodedCredentials.indexOf(":");
  if (separatorIndex < 0) {
    return unauthorizedResponse();
  }

  const username = decodedCredentials.slice(0, separatorIndex);
  const password = decodedCredentials.slice(separatorIndex + 1);

  if (username !== adminUser || password !== adminPass) {
    return unauthorizedResponse();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};
