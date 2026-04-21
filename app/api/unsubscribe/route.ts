import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body.token !== "string") {
      return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    }

    const token = body.token.trim();
    if (!/^[0-9a-f-]{36}$/.test(token)) {
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("subscribers")
      .delete()
      .eq("unsubscribe_token", token)
      .select("id");

    if (error) {
      console.error("[unsubscribe] Supabase error:", error.message);
      return NextResponse.json({ error: "Could not unsubscribe. Please try again." }, { status: 500 });
    }

    return NextResponse.json({ ok: true, removed: (data?.length ?? 0) > 0 }, { status: 200 });
  } catch (err) {
    console.error("[unsubscribe] Unexpected error:", err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
