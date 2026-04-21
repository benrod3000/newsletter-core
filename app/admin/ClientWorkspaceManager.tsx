"use client";

import { useEffect, useMemo, useState } from "react";

type Role = "owner" | "editor" | "viewer";

interface Workspace {
  id: string;
  name: string;
  slug: string;
  created_at: string;
}

interface AdminUser {
  id: string;
  username: string;
  role: Role;
  active: boolean;
  client_id: string | null;
  created_at: string;
}

export default function ClientWorkspaceManager() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<"idle" | "saving" | "error" | "success">("idle");
  const [feedback, setFeedback] = useState("");

  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceSlug, setWorkspaceSlug] = useState("");

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("editor");
  const [clientId, setClientId] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [setupMessage, setSetupMessage] = useState("");

  const workspaceNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const ws of workspaces) map.set(ws.id, ws.name);
    return map;
  }, [workspaces]);

  const filteredUsers = useMemo(() => {
    const term = userSearch.trim().toLowerCase();
    if (!term) return users;
    return users.filter((user) => {
      const workspaceLabel = user.client_id ? workspaceNameById.get(user.client_id) ?? "workspace" : "global";
      return `${user.username} ${user.role} ${workspaceLabel}`.toLowerCase().includes(term);
    });
  }, [users, userSearch, workspaceNameById]);

  const activeUsers = users.filter((user) => user.active).length;

  async function loadData() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/workspaces");
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setStatus("error");
        setFeedback(data?.error ?? "Failed to load workspace data.");
        return;
      }

      setWorkspaces(data.clients ?? []);
      setUsers(data.users ?? []);
      setSetupMessage(typeof data?.setupMessage === "string" ? data.setupMessage : "");
      if (!clientId && data.clients?.[0]?.id) {
        setClientId(data.clients[0].id);
      }
    } catch {
      setStatus("error");
      setFeedback("Network error while loading workspace data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  async function handleCreateWorkspace(e: React.FormEvent) {
    e.preventDefault();
    setStatus("saving");
    setFeedback("");

    try {
      const res = await fetch("/api/admin/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: workspaceName,
          slug: workspaceSlug,
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setStatus("error");
        setFeedback(data?.error ?? "Could not create workspace.");
        return;
      }

      setStatus("success");
      setFeedback(`Workspace created: ${workspaceName}`);
      setWorkspaceName("");
      setWorkspaceSlug("");
      await loadData();
    } catch {
      setStatus("error");
      setFeedback("Network error while creating workspace.");
    }
  }

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    setStatus("saving");
    setFeedback("");

    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          password,
          role,
          clientId: role === "owner" ? null : clientId,
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setStatus("error");
        setFeedback(data?.error ?? "Could not create user.");
        return;
      }

      setStatus("success");
      setFeedback(`User created: ${username}`);
      setUsername("");
      setPassword("");
      setRole("editor");
      await loadData();
    } catch {
      setStatus("error");
      setFeedback("Network error while creating user.");
    }
  }

  async function setUserActive(userId: string, active: boolean) {
    setStatus("saving");
    setFeedback("");

    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set-active", active }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setStatus("error");
        setFeedback(data?.error ?? "Failed to update user status.");
        return;
      }

      setStatus("success");
      setFeedback(active ? "User activated." : "User deactivated.");
      await loadData();
    } catch {
      setStatus("error");
      setFeedback("Network error while updating user status.");
    }
  }

  async function resetUserPassword(userId: string, usernameForPrompt: string) {
    const password = window.prompt(`Set a new password for ${usernameForPrompt} (min 8 chars):`, "");
    if (!password) return;

    setStatus("saving");
    setFeedback("");

    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset-password", password }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setStatus("error");
        setFeedback(data?.error ?? "Failed to reset password.");
        return;
      }

      setStatus("success");
      setFeedback(`Password updated for ${usernameForPrompt}.`);
      await loadData();
    } catch {
      setStatus("error");
      setFeedback("Network error while resetting password.");
    }
  }

  return (
    <section className="mb-6 rounded-lg border border-zinc-800 bg-zinc-900/70 p-4 sm:p-5">
      <div className="mb-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-amber-400">Client Accounts</p>
        <h2 className="mt-1 text-lg font-semibold text-white">Workspaces and logins</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Owner-only panel to create client workspaces and role-based accounts.
        </p>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 px-3 py-2">
          <p className="text-xs uppercase tracking-wider text-zinc-500">Workspaces</p>
          <p className="mt-1 text-xl font-semibold text-white">{workspaces.length}</p>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 px-3 py-2">
          <p className="text-xs uppercase tracking-wider text-zinc-500">Admin users</p>
          <p className="mt-1 text-xl font-semibold text-white">{users.length}</p>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 px-3 py-2">
          <p className="text-xs uppercase tracking-wider text-zinc-500">Active</p>
          <p className="mt-1 text-xl font-semibold text-emerald-300">{activeUsers}</p>
        </div>
      </div>

      {setupMessage && (
        <div className="mb-4 rounded-lg border border-amber-700/60 bg-amber-950/30 px-3 py-3 text-sm text-amber-200">
          <p className="font-medium">Workspace setup required</p>
          <p className="mt-1 text-amber-300/90">{setupMessage}</p>
          <p className="mt-1 text-xs text-amber-300/80">
            Run: supabase db push
          </p>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <form onSubmit={handleCreateWorkspace} className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-4 space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">Create workspace</h3>
          <input
            type="text"
            value={workspaceName}
            onChange={(e) => setWorkspaceName(e.target.value)}
            placeholder="Acme Client"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 outline-none focus:border-amber-400"
            required
          />
          <input
            type="text"
            value={workspaceSlug}
            onChange={(e) => setWorkspaceSlug(e.target.value)}
            placeholder="acme-client (optional)"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 outline-none focus:border-amber-400"
          />
          <button
            type="submit"
            disabled={status === "saving"}
            className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-black hover:bg-amber-300 disabled:opacity-60"
          >
            Add workspace
          </button>
        </form>

        <form onSubmit={handleCreateUser} className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-4 space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">Create user</h3>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="acme-editor"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 outline-none focus:border-amber-400"
            required
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="temporary password"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 outline-none focus:border-amber-400"
            required
          />
          <div className="grid grid-cols-2 gap-2">
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-amber-400"
            >
              <option value="editor">editor</option>
              <option value="viewer">viewer</option>
              <option value="owner">owner</option>
            </select>

            <select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              disabled={role === "owner"}
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-amber-400 disabled:opacity-50"
            >
              {workspaces.map((ws) => (
                <option key={ws.id} value={ws.id}>{ws.name}</option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={status === "saving"}
            className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-black hover:bg-amber-300 disabled:opacity-60"
          >
            Add user
          </button>
        </form>
      </div>

      {feedback && (
        <p className={`mt-3 text-sm ${status === "error" ? "text-red-400" : "text-zinc-400"}`}>
          {feedback}
        </p>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-4">
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-zinc-400">Workspaces</h3>
          {loading ? (
            <p className="text-xs text-zinc-600">Loading...</p>
          ) : workspaces.length === 0 ? (
            <p className="text-xs text-zinc-600">No workspaces yet.</p>
          ) : (
            <ul className="space-y-1 text-sm text-zinc-300">
              {workspaces.map((ws) => (
                <li key={ws.id}>
                  {ws.name} <span className="text-zinc-500">({ws.slug})</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">Admin users</h3>
            <input
              type="search"
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              placeholder="Search users"
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 outline-none focus:border-amber-400"
            />
          </div>
          {loading ? (
            <p className="text-xs text-zinc-600">Loading...</p>
          ) : filteredUsers.length === 0 ? (
            <p className="text-xs text-zinc-600">No admin users yet.</p>
          ) : (
            <ul className="space-y-2 text-sm text-zinc-300">
              {filteredUsers.map((u) => (
                <li key={u.id} className="rounded border border-zinc-800 px-2 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <span className="font-medium text-zinc-200">{u.username}</span>{" "}
                      <span className="text-zinc-500">[{u.role}]</span>{" "}
                      <span className="text-zinc-500">
                        {u.client_id ? workspaceNameById.get(u.client_id) ?? "workspace" : "global"}
                      </span>{" "}
                      <span className={u.active ? "text-emerald-400" : "text-red-400"}>
                        {u.active ? "active" : "inactive"}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setUserActive(u.id, !u.active)}
                        className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-zinc-500"
                      >
                        {u.active ? "Deactivate" : "Activate"}
                      </button>
                      <button
                        type="button"
                        onClick={() => resetUserPassword(u.id, u.username)}
                        className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-zinc-500"
                      >
                        Reset password
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
