import { NextRequest, NextResponse } from "next/server";
import { hashPassword, verifyPassword } from "@/lib/jwt";

/**
 * GET /api/admin/demo/check-login
 * Diagnostics: checks if demo user exists and password matches.
 * Protected by admin Basic Auth.
 */
export async function GET(req: NextRequest) {
  try {
    const supabaseUrl = process.env.SUPABASE_URL!;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const auth = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, "Content-Type": "application/json" };

    // Test 1: Find demo user
    const findRes = await fetch(
      `${supabaseUrl}/rest/v1/workspace_users?select=id,email,password_hash,is_active&email=eq.demo%40veloce.app&limit=1`,
      { headers: auth }
    );
    const users = await findRes.json();
    const userFound = Array.isArray(users) && users.length > 0;
    const hashFormat = userFound ? (users[0].password_hash || "").split(":").length === 3 ? "valid" : "invalid" : "n/a";
    const isActive = userFound ? users[0].is_active : "n/a";

    // Test 2: Verify the known password
    let pwMatch = "not tested";
    if (userFound) {
      const { valid } = await verifyPassword("demo123456", users[0].password_hash);
      pwMatch = valid ? "yes" : "no";
    }

    return NextResponse.json({
      user_found: userFound,
      is_active: isActive,
      hash_format: hashFormat,
      password_matches_demo123456: pwMatch,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Check failed" }, { status: 500 });
  }
}
