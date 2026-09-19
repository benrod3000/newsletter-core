import { randomUUID } from "node:crypto";
import { z } from "zod";
import { withWorkspace } from "@/lib/with-workspace";
import { apiSuccess, apiError, apiInternalError } from "@/lib/api-response";
import { getSupabaseClient } from "@/lib/supabase";
import { rateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/client-ip";
import { logError } from "@/lib/logger";
import { checkUpload, buildStoragePath, sanitizeFilename } from "@/lib/assets";

export const ASSETS_BUCKET = "assets";

const bodySchema = z.object({
  filename: z.string().min(1).max(400),
  mime: z.string().min(1).max(200),
  bytes: z.number().int().positive(),
});

/**
 * POST /api/clients/[workspaceId]/assets/upload-url
 *
 * Authorise an upload and hand back a URL the browser can PUT the bytes to.
 *
 * The file does not pass through this route, deliberately. Vercel caps
 * serverless request bodies at a few megabytes, so proxying uploads would put a
 * hard ceiling under the feature that no amount of config moves. It also avoids
 * needing Supabase Auth: Veloce signs its own JWTs, so `auth.uid()` is null
 * inside storage RLS and a policy keyed on it could never match. Authorisation
 * happens here, where the workspace and role are actually known, and Storage
 * only ever sees a short-lived signed URL that was issued after those checks.
 *
 * Nothing is recorded yet. The row is written by POST /assets once the bytes
 * have landed, so a cancelled or failed upload leaves no library entry claiming
 * a file that is not there.
 */
export const POST = withWorkspace(async ({ req, ctx }) => {
  // Issuing signed upload URLs is cheap but not free, and each one is a licence
  // to write into the bucket. Fails closed: a limiter outage should not become
  // an open upload endpoint.
  const rl = await rateLimit(`asset-upload-url:${ctx.workspaceId}:${getClientIp(req)}`, 30, 30, "closed");
  if (!rl.allowed) {
    return apiError(429, "RATE_LIMITED", "Too many uploads. Wait a moment and try again.");
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return apiError(400, "BAD_REQUEST", "Expected filename, mime and bytes.");
  }

  const supabase = getSupabaseClient();

  const { data: usedBytes, error: usageError } = await supabase.rpc("workspace_storage_used", {
    p_workspace_id: ctx.workspaceId,
  });

  if (usageError) {
    logError(usageError, { route: "clients.assets.upload-url", workspaceId: ctx.workspaceId });
    return apiInternalError("Could not check library usage");
  }

  /*
   * The quota is checked against the reported size before the bytes exist,
   * which means a client could understate it. The bucket carries its own
   * `file_size_limit` (migration 078) so the per-file cap holds regardless, and
   * POST /assets re-reads the object's real size from Storage before recording
   * it - so an understated upload is caught before it can count for less than
   * it weighs.
   */
  const verdict = checkUpload({ mime: body.mime, bytes: body.bytes, usedBytes: usedBytes ?? 0 });
  if (!verdict.ok) {
    return apiError(400, verdict.code.toUpperCase(), verdict.message);
  }

  const storagePath = buildStoragePath(ctx.workspaceId, verdict.extension, randomUUID());

  const { data, error } = await supabase.storage
    .from(ASSETS_BUCKET)
    .createSignedUploadUrl(storagePath);

  if (error || !data) {
    logError(error ?? new Error("No signed upload URL returned"), {
      route: "clients.assets.upload-url",
      workspaceId: ctx.workspaceId,
    });
    return apiInternalError("Could not start the upload");
  }

  return apiSuccess({
    signed_url: data.signedUrl,
    token: data.token,
    storage_path: storagePath,
    filename: sanitizeFilename(body.filename),
    mime: body.mime,
  });
}, { minRole: "editor" });
