import { NextRequest } from "next/server";
import { SupabaseClient } from "@supabase/supabase-js";
import { getClientContextFromJWT } from "./client-context";
import { getWorkspaceScopedClient } from "./db-token";
import { getSupabaseClient } from "./supabase";
import { apiError, apiForbidden, apiInternalError, apiUnauthorized } from "./api-response";
import { logError } from "./logger";

/**
 * The single entry point for a workspace-scoped route.
 *
 * It replaces the pattern repeated across 45 handlers:
 *
 *     const ctx = getClientContextFromJWT(req);
 *     if (!ctx || !assertWorkspaceAccess(ctx, workspaceId)) return 401;
 *
 * which has two problems beyond the duplication. First, it is opt-in: a new route
 * that forgets it has no isolation at all, and nothing fails until someone
 * notices. Second, assertWorkspaceAccess only compares the JWT's workspaceId
 * claim to the path segment - it never asks the database whether the membership
 * still exists. A token minted before a user was removed from a workspace keeps
 * working until it expires, which for a 30-day session token is a long time.
 *
 * withWorkspace() closes both:
 *
 *   1. Verify the session token           -> who is calling
 *   2. Read workspaceId from the path     -> what they are asking for
 *   3. Look up the membership row         -> may they, RIGHT NOW
 *   4. Mint a workspace-scoped DB token   -> credential derived from step 3
 *   5. Hand the handler a scoped client   -> the database enforces the rest
 *
 * Authority comes from the membership row, not from the token. The token says who
 * you are; the database says what that currently means. This is the shape the
 * architecture calls for - the token identifies the user, the path identifies the
 * workspace, Membership authorizes - and it is what makes revocation and role
 * changes take effect immediately instead of at token expiry.
 */

export type WorkspaceRole = "owner" | "editor" | "viewer";

export interface WorkspaceContext {
  workspaceId: string;
  userId: string;
  email: string;
  /** Read from workspace_users at request time, NOT from the token claim. */
  role: WorkspaceRole;
}

export interface WorkspaceHandlerArgs<P> {
  req: NextRequest;
  ctx: WorkspaceContext;
  /**
   * Supabase client scoped to ctx.workspaceId by row-level security.
   *
   * Queries through this client cannot return another workspace's rows, so
   * `.eq("workspace_id", ...)` is no longer what keeps tenants apart. Existing
   * filters are fine to leave in place - they are now redundant, not load-bearing.
   *
   * System work that legitimately spans tenants (cron, provider webhooks, signup,
   * auth) must NOT use this client. Those paths use getSupabaseClient() and are
   * expected to justify themselves.
   */
  db: SupabaseClient;
  params: P;
}

const ROLE_RANK: Record<WorkspaceRole, number> = { viewer: 0, editor: 1, owner: 2 };

export interface WithWorkspaceOptions {
  /**
   * Minimum role required. Defaults to "viewer" (any active member).
   *
   * Expressed as a role bundle rather than a hand-written check so that when
   * roles become named permission sets, this becomes a lookup rather than a
   * refactor of every handler.
   */
  minRole?: WorkspaceRole;
}

type Handler<P> = (args: WorkspaceHandlerArgs<P>) => Promise<Response> | Response;

export function withWorkspace<P extends { workspaceId: string }>(
  handler: Handler<P>,
  options: WithWorkspaceOptions = {}
) {
  const minRole = options.minRole ?? "viewer";

  return async function (
    req: NextRequest,
    route: { params: Promise<P> }
  ): Promise<Response> {
    let params: P;
    try {
      params = await route.params;
    } catch {
      return apiError(400, "BAD_REQUEST", "Malformed route parameters");
    }

    const workspaceId = params?.workspaceId;
    if (!workspaceId) {
      return apiError(400, "BAD_REQUEST", "Missing workspace in request path");
    }

    const session = getClientContextFromJWT(req);
    if (!session) return apiUnauthorized();

    try {
      // Membership is resolved with the system client on purpose: this is the
      // query that decides whether a scoped credential may be minted at all, so
      // it cannot itself be scoped. It is the one unavoidable service_role read
      // on the authenticated path.
      const { data: membership, error } = await getSupabaseClient()
        .from("workspace_users")
        .select("id, email, role, is_active")
        .eq("id", session.userId)
        .eq("workspace_id", workspaceId)
        .maybeSingle();

      // supabase-js resolves failures as { error } rather than throwing, so this
      // must be checked explicitly. Treating a failed lookup as "no membership"
      // is the only safe reading: a database problem must not become access.
      if (error) {
        logError(error, { route: "withWorkspace.membership", workspaceId, userId: session.userId });
        return apiInternalError();
      }

      // Deliberately indistinguishable from "not a member". Telling a caller that
      // a workspace exists but is not theirs is a membership oracle.
      if (!membership || !membership.is_active) return apiUnauthorized();

      const role = membership.role as WorkspaceRole;
      if (ROLE_RANK[role] === undefined) {
        logError(new Error(`Unrecognized role "${membership.role}"`), {
          route: "withWorkspace.role",
          workspaceId,
          userId: session.userId,
        });
        return apiInternalError();
      }

      if (ROLE_RANK[role] < ROLE_RANK[minRole]) {
        return apiForbidden(`This action requires the ${minRole} role`);
      }

      const ctx: WorkspaceContext = {
        workspaceId,
        userId: session.userId,
        email: membership.email ?? session.email,
        role,
      };

      return await handler({
        req,
        ctx,
        db: getWorkspaceScopedClient(workspaceId, session.userId),
        params,
      });
    } catch (err) {
      logError(err, { route: "withWorkspace", workspaceId, userId: session.userId });
      return apiInternalError();
    }
  };
}
