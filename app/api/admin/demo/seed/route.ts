import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { hashPassword } from "@/lib/jwt";

/**
 * POST /api/admin/demo/seed
 * Seeds the demo workspace with realistic data.
 * Delegates to a PostgreSQL function that runs everything in a single transaction.
 * No more hundreds of individual REST calls.
 */

export async function POST(_req: NextRequest) {
  const suUrl = process.env.SUPABASE_URL;
  const suKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!suUrl || !suKey) {
    return NextResponse.json({ error: "Missing Supabase env vars" }, { status: 500 });
  }

  try {
    const auth = { apikey: suKey, Authorization: `Bearer ${suKey}`, "Content-Type": "application/json" };

    // 1. Find or create the demo user + workspace
    let wsRes = await fetch(
      `${suUrl}/rest/v1/workspace_users?select=id,workspace_id,email&email=eq.demo%40veloce.app&limit=1`,
      { headers: auth }
    );
    let users = await wsRes.json();
    let workspaceId: string;
    let demoUserId: string;
    const demoPasswordHash = await hashPassword("demo123456");

    if (!Array.isArray(users) || users.length === 0) {
      // Create workspace
      const createWs = await fetch(`${suUrl}/rest/v1/clients`, {
        method: "POST",
        headers: { ...auth, Prefer: "return=representation" },
        body: JSON.stringify({ name: "Demo Workspace", slug: `demo-${crypto.randomUUID().split("-")[0]}` }),
      });
      const wsData = await createWs.json();
      workspaceId = wsData?.[0]?.id;
      if (!workspaceId) throw new Error("Failed to create demo workspace");

      // Create user
      const createUser = await fetch(`${suUrl}/rest/v1/workspace_users`, {
        method: "POST",
        headers: { ...auth, Prefer: "return=representation" },
        body: JSON.stringify({ workspace_id: workspaceId, email: "demo@veloce.app", password_hash: demoPasswordHash, role: "owner", is_active: true }),
      });
      const userData = await createUser.json();
      demoUserId = userData?.[0]?.id || "new";
    } else {
      workspaceId = users[0].workspace_id;
      demoUserId = users[0].id;
      // Ensure password is correct
      await fetch(`${suUrl}/rest/v1/workspace_users?id=eq.${users[0].id}`, {
        method: "PATCH",
        headers: { ...auth, Prefer: "return=minimal" },
        body: JSON.stringify({ password_hash: demoPasswordHash }),
      });
    }

    // 2. Run the seed SQL function (everything in one transaction)
    const rpcRes = await fetch(`${suUrl}/rest/v1/rpc/seed_demo_data`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ p_workspace_id: workspaceId }),
    });

    if (!rpcRes.ok) {
      const errText = await rpcRes.text();
      throw new Error(`RPC failed: ${errText}`);
    }

    const result = await rpcRes.json();

    // 3. Verify password
    let pwValid = false;
    if (demoUserId) {
      const verifyRes = await fetch(
        `${suUrl}/rest/v1/workspace_users?select=password_hash&id=eq.${demoUserId}&limit=1`,
        { headers: auth }
      );
      const verifyData = await verifyRes.json();
      const pwHash = verifyData?.[0]?.password_hash || "";
      pwValid = pwHash.startsWith("600000:");
    }

    return NextResponse.json({
      ok: true,
      workspace_id: workspaceId,
      ...(typeof result === "object" ? result : {}),
      password_reset: pwValid,
    });
  } catch (error: any) {
    console.error("Demo seed error:", error?.message || error);
    return NextResponse.json({ error: error?.message || "Seed failed" }, { status: 500 });
  }
}
