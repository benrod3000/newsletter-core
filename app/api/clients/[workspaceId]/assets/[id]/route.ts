import { withWorkspace } from "@/lib/with-workspace";
import { apiSuccess, apiError, apiNotFound, apiInternalError } from "@/lib/api-response";
import { getSupabaseClient } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import { logAudit, extractRequestMeta, AUDIT_ACTIONS } from "@/lib/audit-log";
import { ASSETS_BUCKET } from "../upload-url/route";

/**
 * DELETE /api/clients/[workspaceId]/assets/[id]
 *
 * Remove a file from the library, unless a giveaway is still handing it out.
 *
 * The guard is the point. Emails already sitting in inboxes link to this file
 * through /api/track/click, and those links do not expire - so deleting an
 * asset a live widget still offers does not break a page the operator can see,
 * it breaks the download for everyone who has not claimed it yet, silently,
 * after they have already given up their address. Refusing and naming the
 * widget lets the operator decide, rather than discovering it from a complaint.
 *
 * Unreferenced files delete for real, object first. An orphaned object nobody
 * can see would still count against the project's storage.
 */
export const DELETE = withWorkspace<{ workspaceId: string; id: string }>(
  async ({ req, ctx, db, params }) => {
    const { data: asset, error: readError } = await db
      .from("assets")
      .select("id, filename, storage_path, bytes")
      .eq("id", params.id)
      .eq("workspace_id", ctx.workspaceId)
      .maybeSingle();

    if (readError) {
      logError(readError, { route: "clients.assets.delete", workspaceId: ctx.workspaceId });
      return apiInternalError("Could not load that file");
    }
    if (!asset) return apiNotFound("File");

    const { data: usedBy, error: refError } = await db
      .from("widgets")
      .select("id, name")
      .eq("workspace_id", ctx.workspaceId)
      .eq("asset_id", params.id)
      .limit(5);

    if (refError) {
      // Deleting without knowing whether it is referenced is the one outcome
      // worth refusing outright: it is unrecoverable for the subscribers who
      // have not claimed yet, and the operator gets no signal.
      logError(refError, { route: "clients.assets.delete", workspaceId: ctx.workspaceId });
      return apiInternalError("Could not check whether that file is in use");
    }

    if (usedBy && usedBy.length > 0) {
      const names = usedBy.map((w) => w.name).filter(Boolean).join(", ");
      return apiError(
        409,
        "IN_USE",
        `Still being given away by ${usedBy.length === 1 ? names : `${usedBy.length} widgets: ${names}`}. Point them somewhere else first.`
      );
    }

    const supabase = getSupabaseClient();
    const { error: removeError } = await supabase.storage
      .from(ASSETS_BUCKET)
      .remove([asset.storage_path]);

    if (removeError) {
      logError(removeError, { route: "clients.assets.delete", workspaceId: ctx.workspaceId });
      return apiInternalError("Could not delete the file");
    }

    const { error: rowError } = await db
      .from("assets")
      .delete()
      .eq("id", params.id)
      .eq("workspace_id", ctx.workspaceId);

    if (rowError) {
      // The object is already gone, so the row now describes a file that does
      // not exist. Reported rather than swallowed: the library will show an
      // entry whose download 404s until this is cleaned up.
      logError(rowError, { route: "clients.assets.delete.row", workspaceId: ctx.workspaceId });
      return apiInternalError("The file was removed but the library entry could not be cleared");
    }

    await logAudit({
      workspace_id: ctx.workspaceId,
      user_id: ctx.userId,
      action: AUDIT_ACTIONS.ASSET_DELETED,
      details: { asset_id: params.id, filename: asset.filename, bytes: asset.bytes },
      ...extractRequestMeta(req),
    });

    return apiSuccess({ deleted: true });
  },
  { minRole: "editor" }
);
