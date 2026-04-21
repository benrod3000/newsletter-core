export type AdminRole = "owner" | "editor" | "viewer";

export interface AdminContext {
  username: string;
  role: AdminRole;
  clientId: string | null;
}

export function getAdminContextFromHeaders(headers: Headers): AdminContext | null {
  const username = headers.get("x-admin-username");
  const roleRaw = headers.get("x-admin-role");
  const clientId = headers.get("x-admin-client-id");

  if (!username || !roleRaw) return null;
  if (roleRaw !== "owner" && roleRaw !== "editor" && roleRaw !== "viewer") return null;

  return {
    username,
    role: roleRaw,
    clientId: clientId || null,
  };
}

export function canEditCampaigns(ctx: AdminContext) {
  return ctx.role === "owner" || ctx.role === "editor";
}

export function canSendCampaigns(ctx: AdminContext) {
  return ctx.role === "owner" || ctx.role === "editor";
}
