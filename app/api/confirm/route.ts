import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const leadTitle = req.nextUrl.searchParams.get("lead_title")?.trim() || null;
  const leadUrlRaw = req.nextUrl.searchParams.get("lead_url")?.trim() || null;

  let leadUrl: string | null = null;
  if (leadUrlRaw) {
    try {
      const parsed = new URL(leadUrlRaw);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        leadUrl = parsed.toString();
      }
    } catch {
      leadUrl = null;
    }
  }

  const buildRedirect = (status: string) => {
    const url = new URL(`/confirmed?status=${status}`, req.url);
    if (leadTitle) url.searchParams.set("lead_title", leadTitle);
    if (leadUrl) url.searchParams.set("lead_url", leadUrl);
    return url;
  };

  if (!token || !/^[0-9a-f-]{36}$/.test(token)) {
    return NextResponse.redirect(buildRedirect("invalid"));
  }

  const supabase = getSupabaseClient();
  const { data: existing, error: lookupError } = await supabase
    .from("subscribers")
    .select("id, confirmed")
    .eq("confirmation_token", token)
    .maybeSingle();

  if (lookupError) {
    console.error("[confirm] Supabase lookup error:", lookupError.message);
    return NextResponse.redirect(buildRedirect("error"));
  }

  if (!existing) {
    return NextResponse.redirect(buildRedirect("invalid"));
  }

  if (existing.confirmed) {
    return NextResponse.redirect(buildRedirect("already"));
  }

  const { error } = await supabase
    .from("subscribers")
    .update({ confirmed: true })
    .eq("id", existing.id);

  if (error) {
    console.error("[confirm] Supabase error:", error.message);
    return NextResponse.redirect(buildRedirect("error"));
  }

  return NextResponse.redirect(buildRedirect("ok"));
}
