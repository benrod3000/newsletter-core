import { NextRequest } from "next/server";
import crypto from "crypto";
import { hashPassword } from "@/lib/jwt";
import { DEMO_EMAIL, getDemoPassword } from "@/lib/demo";
import { getAdminContextFromHeaders } from "@/lib/admin-context";
import { apiSuccess, apiUnauthorized, apiInternalError } from "@/lib/api-response";
import { applyRateLimit, rateLimitedResponse } from "@/lib/rate-limit-middleware";

/**
 * POST /api/admin/demo/seed
 * Seeds the demo workspace with realistic data.
 * Protected by admin auth + rate limiting.
 */
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const admin = getAdminContextFromHeaders(req.headers);
  if (!admin) return apiUnauthorized();

  const rl = await applyRateLimit(req, { max: 1, windowSec: 300 });
  if (!rl.allowed) return rateLimitedResponse(rl);
  const suUrl = process.env.SUPABASE_URL;
  const suKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!suUrl || !suKey) return apiInternalError("Missing Supabase env vars");

  try {
    const auth = { apikey: suKey, Authorization: `Bearer ${suKey}`, "Content-Type": "application/json" };

    // 1. Find or create the demo user + workspace
    const wsRes = await fetch(
      `${suUrl}/rest/v1/workspace_users?select=id,workspace_id,email&email=eq.${encodeURIComponent(DEMO_EMAIL)}&limit=1`,
      { headers: auth }
    );
    const users = await wsRes.json();
    let workspaceId: string;
    let demoUserId: string;
    const demoPasswordHash = await hashPassword(getDemoPassword());

    if (!Array.isArray(users) || users.length === 0) {
      // Every workspace belongs to an organization (clients.org_id is NOT NULL as
      // of migration 047), so the demo workspace needs one too.
      const createOrg = await fetch(`${suUrl}/rest/v1/organizations`, {
        method: "POST",
        headers: { ...auth, Prefer: "return=representation" },
        body: JSON.stringify({ name: "Demo Organization" }),
      });
      const orgData = await createOrg.json();
      const orgId = orgData?.[0]?.id;
      if (!orgId) throw new Error("Failed to create demo organization");

      // Create workspace
      const createWs = await fetch(`${suUrl}/rest/v1/clients`, {
        method: "POST",
        headers: { ...auth, Prefer: "return=representation" },
        body: JSON.stringify({ name: "Demo Workspace", slug: `demo-${crypto.randomUUID().split("-")[0]}`, sandbox_mode: true, org_id: orgId }),
      });
      const wsData = await createWs.json();
      workspaceId = wsData?.[0]?.id;
      if (!workspaceId) throw new Error("Failed to create demo workspace");

      // Create user
      const createUser = await fetch(`${suUrl}/rest/v1/workspace_users`, {
        method: "POST",
        headers: { ...auth, Prefer: "return=representation" },
        body: JSON.stringify({ workspace_id: workspaceId, email: DEMO_EMAIL, password_hash: demoPasswordHash, role: "owner", is_active: true }),
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

    return apiSuccess({
      ok: true,
      workspace_id: workspaceId,
      ...(typeof result === "object" ? result : {}),
      password_reset: pwValid,
    });
  } catch (error: any) {
    console.error("Demo seed error:", error?.message || error);
    return apiInternalError(error?.message || "Seed failed");
  }
}
