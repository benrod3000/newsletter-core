import { NextRequest, NextResponse } from "next/server";
import { hashPassword } from "@/lib/jwt";

/**
 * POST /api/admin/demo/reset-password
 * Resets the demo account password. Fast — no subscriber/campaign seeding.
 * Protected by admin Basic Auth (handled by proxy.ts middleware).
 */
export async function POST(req: NextRequest) {
  try {
    const supabaseUrl = process.env.SUPABASE_URL!;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const auth = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, "Content-Type": "application/json" };

    // Find demo user
    const findRes = await fetch(
      `${supabaseUrl}/rest/v1/workspace_users?select=id,email&email=eq.demo%40veloce.app&limit=1`,
      { headers: auth }
    );
    const users = await findRes.json();

    if (!Array.isArray(users) || users.length === 0) {
      return NextResponse.json({ error: "Demo user not found" }, { status: 404 });
    }

    // Reset password
    const passwordHash = await hashPassword("demo123456");
    const patchRes = await fetch(
      `${supabaseUrl}/rest/v1/workspace_users?id=eq.${users[0].id}`,
      {
        method: "PATCH",
        headers: { ...auth, Prefer: "return=representation" },
        body: JSON.stringify({ password_hash: passwordHash }),
      }
    );

    if (!patchRes.ok) {
      const err = await patchRes.text();
      return NextResponse.json({ error: `Password reset failed: ${err}` }, { status: 500 });
    }

    const updated = await patchRes.json();
    return NextResponse.json({
      ok: true,
      user_id: users[0].id,
      email: users[0].email,
      hash_prefix: passwordHash.slice(0, 30) + "...",
    });
  } catch (error: any) {
    console.error("Password reset error:", error?.message || error);
    return NextResponse.json({ error: error?.message || "Failed" }, { status: 500 });
  }
}
