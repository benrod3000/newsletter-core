import { NextResponse } from "next/server";
import { withWorkspace } from "@/lib/with-workspace";
import { getSupabaseClient } from "@/lib/supabase";
import { hashPassword } from "@/lib/jwt";
import { logError } from "@/lib/logger";

/**
 * GET /api/clients/[workspaceId]/users
 * List workspace users. Owner only.
 *
 * Reads through the scoped client. Migration 049 grants `authenticated` SELECT on
 * exactly these columns and no others - password_hash, totp_secret and
 * recovery_codes are excluded at the privilege level, so this route cannot leak
 * them even if the select list were changed carelessly.
 */
export const GET = withWorkspace(
  async ({ ctx, db }) => {
    const { data, error } = await db
      .from("workspace_users")
      .select("id, email, role, is_active, last_login_at, created_at")
      .eq("workspace_id", ctx.workspaceId)
      .order("created_at", { ascending: true });

    if (error) {
      logError(error, { route: "clients.users.list", workspaceId: ctx.workspaceId });
      return NextResponse.json({ error: "Failed to list users" }, { status: 500 });
    }

    return NextResponse.json({ users: data || [] });
  },
  { minRole: "owner" }
);

/**
 * POST /api/clients/[workspaceId]/users
 * Create a workspace user. Owner only.
 * Body: { email, password, role? }
 */
export const POST = withWorkspace(
  async ({ req, ctx }) => {
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

    const { email, password, role = "editor" } = body;

    if (!email || !password)
      return NextResponse.json({ error: "Email and password required" }, { status: 400 });

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return NextResponse.json({ error: "Invalid email format" }, { status: 400 });

    if (!["owner", "editor", "viewer"].includes(role))
      return NextResponse.json(
        { error: "Invalid role. Must be owner, editor, or viewer." },
        { status: 400 }
      );

    try {
      const passwordHash = await hashPassword(password);

      // Deliberately the service-role client, not the scoped one. Creating a user
      // writes password_hash, and migration 049 grants `authenticated` no write
      // on workspace_users at all - credential material is not something a
      // customer-facing database role should be able to touch. Authorization for
      // this still came from withWorkspace above: owner role, verified against
      // the membership row.
      const { data, error } = await getSupabaseClient()
        .from("workspace_users")
        .insert({ workspace_id: ctx.workspaceId, email, password_hash: passwordHash, role })
        .select("id, email, role")
        .single();

      if (error) {
        if (error.code === "23505")
          return NextResponse.json({ error: "User with this email already exists." }, { status: 409 });
        logError(error, { route: "clients.users.create", workspaceId: ctx.workspaceId });
        return NextResponse.json({ error: "Failed to create user" }, { status: 500 });
      }

      return NextResponse.json(data, { status: 201 });
    } catch (err) {
      logError(err, { route: "clients.users.create", workspaceId: ctx.workspaceId });
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
  },
  { minRole: "owner" }
);
