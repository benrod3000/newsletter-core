import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");

  if (!token || !/^[0-9a-f-]{36}$/.test(token)) {
    return NextResponse.redirect(new URL("/confirmed?status=invalid", req.url));
  }

  const supabase = getSupabaseClient();
  const { data: existing, error: lookupError } = await supabase
    .from("subscribers")
    .select("id, confirmed")
    .eq("confirmation_token", token)
    .maybeSingle();

  if (lookupError) {
    console.error("[confirm] Supabase lookup error:", lookupError.message);
    return NextResponse.redirect(new URL("/confirmed?status=error", req.url));
  }

  if (!existing) {
    return NextResponse.redirect(new URL("/confirmed?status=invalid", req.url));
  }

  if (existing.confirmed) {
    return NextResponse.redirect(new URL("/confirmed?status=already", req.url));
  }

  const { error } = await supabase
    .from("subscribers")
    .update({ confirmed: true })
    .eq("id", existing.id);

  if (error) {
    console.error("[confirm] Supabase error:", error.message);
    return NextResponse.redirect(new URL("/confirmed?status=error", req.url));
  }

  return NextResponse.redirect(new URL("/confirmed?status=ok", req.url));
}
