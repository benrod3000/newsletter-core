import { NextResponse } from "next/server";
import { withWorkspace } from "@/lib/with-workspace";
import { logError } from "@/lib/logger";
import { fetchAllRows } from "@/lib/paginate";

/**
 * Columns of the workspace row that are safe to hand back.
 *
 * This used to be `select=*`, which meant a full workspace export included
 * ses_access_key, ses_secret_key and twilio_auth_token - the workspace's sending
 * credentials, downloadable as JSON by any member, with no role gate at all.
 *
 * Migration 049 makes that unreachable anyway: `authenticated` holds SELECT on
 * named columns of `clients` only, so a `select=*` through the scoped client now
 * fails outright rather than succeeding quietly. The explicit list here is the
 * same decision stated where a reader will actually see it.
 */
const WORKSPACE_COLUMNS =
  "id, org_id, name, slug, created_at, logo_url, brand_colors, custom_domain, " +
  "sender_name, sender_email, email_provider, fallback_provider, sandbox_mode, " +
  "sending_limit_monthly, sending_limit_total, sent_this_month, sent_total";

export const GET = withWorkspace(
  async ({ ctx, db }) => {
    // Subscribers page rather than taking a flat .limit(10000). At 10,300 rows
    // that limit was already dropping ~300 people from every export, silently.
    // The other three tables keep a bounded read: none is anywhere near its cap,
    // and a workspace with 1,000+ campaigns is a different conversation.
    const subscribersPromise = fetchAllRows<{ id: string }>((afterId, pageSize) => {
      let q = db
        .from("subscribers")
        .select("*")
        .eq("workspace_id", ctx.workspaceId)
        .order("id", { ascending: true })
        .limit(pageSize);
      if (afterId) q = q.gt("id", afterId);
      return q;
    }).then(
      (data) => ({ data, error: null as null | { message: string } }),
      (err: Error) => ({ data: [] as { id: string }[], error: { message: err.message } })
    );

    const [subsRes, campsRes, listsRes, widgetsRes, workspaceRes] = await Promise.all([
      subscribersPromise,
      db.from("campaigns").select("*").eq("workspace_id", ctx.workspaceId).limit(1000),
      db.from("subscriber_lists").select("*").eq("workspace_id", ctx.workspaceId).limit(1000),
      db.from("widgets").select("*").eq("workspace_id", ctx.workspaceId).limit(100),
      db.from("clients").select(WORKSPACE_COLUMNS).eq("id", ctx.workspaceId).maybeSingle(),
    ]);

    const failed = [subsRes, campsRes, listsRes, widgetsRes, workspaceRes].find((r) => r.error);
    if (failed?.error) {
      // The previous version swallowed every failure into an empty array, so a
      // partial export was indistinguishable from an empty workspace - the worst
      // possible outcome for something a user may be relying on for a backup or
      // a data-portability request.
      logError(failed.error, { route: "clients.export", workspaceId: ctx.workspaceId });
      return NextResponse.json({ error: "Export failed" }, { status: 500 });
    }

    return NextResponse.json(
      {
        exported_at: new Date().toISOString(),
        workspace: workspaceRes.data ?? null,
        subscribers: subsRes.data ?? [],
        campaigns: campsRes.data ?? [],
        lists: listsRes.data ?? [],
        widgets: widgetsRes.data ?? [],
      },
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": `attachment; filename="veloce-export-${ctx.workspaceId}.json"`,
        },
      }
    );
  },
  // A full-audience export is not a read a viewer should be able to perform.
  { minRole: "editor" }
);
