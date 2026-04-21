import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");

  if (!token || !/^[0-9a-f-]{36}$/.test(token)) {
    return NextResponse.redirect(new URL("/confirmed?status=invalid", req.url));
  }

  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("subscribers")
    .update({ confirmed: true })
    .eq("confirmation_token", token)
    .eq("confirmed", false);

  if (error) {
    console.error("[confirm] Supabase error:", error.message);
    return NextResponse.redirect(new URL("/confirmed?status=error", req.url));
  }

  return NextResponse.redirect(new URL("/confirmed?status=ok", req.url));
}
