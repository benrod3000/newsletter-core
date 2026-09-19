import { z } from "zod";
import { withWorkspace } from "@/lib/with-workspace";
import { apiSuccess, apiError, apiInternalError } from "@/lib/api-response";
import { getSupabaseClient } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import { logAudit, extractRequestMeta, AUDIT_ACTIONS } from "@/lib/audit-log";
import { checkUpload, sanitizeFilename, MAX_WORKSPACE_BYTES } from "@/lib/assets";
import { ASSETS_BUCKET } from "./upload-url/route";

/**
 * GET /api/clients/[workspaceId]/assets
 *
 * The workspace's content library, plus what it is using against its quota.
 *
 * Usage ships with the list rather than from a separate endpoint because the
 * two are always rendered together, and a meter that lags the list it sits
 * above reads as a bug.
 */
export const GET = withWorkspace(async ({ ctx, db }) => {
  const supabase = getSupabaseClient();

  const [{ data: assets, error }, { data: usedBytes, error: usageError }] = await Promise.all([
    db
      .from("assets")
      .select("id, filename, mime, bytes, public_url, created_at")
      .eq("workspace_id", ctx.workspaceId)
      .order("created_at", { ascending: false }),
    supabase.rpc("workspace_storage_used", { p_workspace_id: ctx.workspaceId }),
  ]);

  if (error || usageError) {
    logError(error ?? usageError, { route: "clients.assets.list", workspaceId: ctx.workspaceId });
    return apiInternalError("Could not load the library");
  }

  return apiSuccess({
    assets: assets ?? [],
    used_bytes: usedBytes ?? 0,
    quota_bytes: MAX_WORKSPACE_BYTES,
  });
});

const confirmSchema = z.object({
  storage_path: z.string().min(1).max(500),
  filename: z.string().min(1).max(400),
  sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
});

/**
 * POST /api/clients/[workspaceId]/assets
 *
 * Record an upload that has landed, after checking that it actually did.
 *
 * The size and type are read back from Storage rather than taken from the
 * client. The signed URL was issued against a *claimed* size, so trusting that
 * claim here would let an operator understate a file and have it count for less
 * than it weighs against the quota - and the quota is the thing standing
 * between one popular giveaway and the egress cap that pauses the database.
 *
 * The path is re-derived as workspace-scoped rather than accepted as given, so
 * a caller cannot record someone else's object as their own.
 */
export const POST = withWorkspace(async ({ req, ctx, db }) => {
  let body: z.infer<typeof confirmSchema>;
  try {
    body = confirmSchema.parse(await req.json());
  } catch {
    return apiError(400, "BAD_REQUEST", "Expected storage_path and filename.");
  }

  if (!body.storage_path.startsWith(`${ctx.workspaceId}/`)) {
    return apiError(400, "BAD_REQUEST", "That file does not belong to this workspace.");
  }

  const supabase = getSupabaseClient();
  const slash = body.storage_path.indexOf("/");
  const objectName = body.storage_path.slice(slash + 1);

  const { data: listed, error: statError } = await supabase.storage
    .from(ASSETS_BUCKET)
    .list(ctx.workspaceId, { search: objectName, limit: 1 });

  if (statError) {
    logError(statError, { route: "clients.assets.create", workspaceId: ctx.workspaceId });
    return apiInternalError("Could not verify the upload");
  }

  const object = listed?.find((o) => o.name === objectName);
  if (!object) {
    // The upload never completed. Saying so beats recording a library entry
    // that promises a download returning 404 to whoever claims it.
    return apiError(404, "NOT_FOUND", "That upload did not complete. Try again.");
  }

  const bytes = Number(object.metadata?.size ?? 0);
  const mime = String(object.metadata?.mimetype ?? "application/octet-stream");

  const { data: usedBytes } = await supabase.rpc("workspace_storage_used", {
    p_workspace_id: ctx.workspaceId,
  });

  // Re-checked against the real bytes. If it fails now the object is removed
  // rather than left orphaned in the bucket, where it would consume storage
  // that no library row accounts for and no operator can see to delete.
  const verdict = checkUpload({ mime, bytes, usedBytes: usedBytes ?? 0 });
  if (!verdict.ok) {
    await supabase.storage.from(ASSETS_BUCKET).remove([body.storage_path]);
    return apiError(400, verdict.code.toUpperCase(), verdict.message);
  }

  const { data: publicUrl } = supabase.storage.from(ASSETS_BUCKET).getPublicUrl(body.storage_path);

  const { data: asset, error } = await db
    .from("assets")
    .insert({
      workspace_id: ctx.workspaceId,
      filename: sanitizeFilename(body.filename),
      mime,
      bytes,
      sha256: body.sha256 ?? null,
      storage_path: body.storage_path,
      public_url: publicUrl.publicUrl,
      created_by: ctx.userId,
    })
    .select("id, filename, mime, bytes, public_url, created_at")
    .single();

  if (error || !asset) {
    await supabase.storage.from(ASSETS_BUCKET).remove([body.storage_path]);
    logError(error, { route: "clients.assets.create", workspaceId: ctx.workspaceId });
    return apiInternalError("Could not save the file");
  }

  await logAudit({
    workspace_id: ctx.workspaceId,
    user_id: ctx.userId,
    action: AUDIT_ACTIONS.ASSET_UPLOADED,
    details: { asset_id: asset.id, filename: asset.filename, bytes, mime },
    ...extractRequestMeta(req),
  });

  return apiSuccess({ asset }, 201);
}, { minRole: "editor" });
