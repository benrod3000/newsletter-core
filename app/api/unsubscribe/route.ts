import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";

async function unsubscribeByToken(token: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/.test(token)) return false;
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("subscribers")
    .delete()
    .eq("unsubscribe_token", token)
    .select("id");
  if (error) {
    console.error("[unsubscribe] Supabase error:", error.message);
    return false;
  }
  return (data?.length ?? 0) > 0;
}

// One-click unsubscribe per RFC 8058 / Gmail+Yahoo requirement.
// Email clients POST to this URL with no body — token is in the query string.
export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const queryToken = searchParams.get("token");

  // One-click path: token in query string (List-Unsubscribe-Post header)
  if (queryToken) {
    try {
      await unsubscribeByToken(queryToken.trim());
      return new NextResponse(null, { status: 200 });
    } catch (err) {
      console.error("[unsubscribe] Unexpected error:", err);
      return new NextResponse(null, { status: 500 });
    }
  }

  // Legacy path: token in JSON body (used by the unsubscribe page form)
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body.token !== "string") {
      return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    }

    const removed = await unsubscribeByToken(body.token.trim());
    return NextResponse.json({ ok: true, removed }, { status: 200 });
  } catch (err) {
    console.error("[unsubscribe] Unexpected error:", err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
