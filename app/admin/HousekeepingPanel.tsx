"use client";

import { useState } from "react";

interface TaskState {
  preview: number | null;
  loading: boolean;
  confirmed: boolean;
  result: number | null;
  error: string;
}

function emptyTask(): TaskState {
  return { preview: null, loading: false, confirmed: false, result: null, error: "" };
}

async function callHousekeeping(action: string, extra: Record<string, unknown>) {
  const res = await fetch("/api/admin/housekeeping", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...extra }),
  });
  return res.json().catch(() => null);
}

export default function HousekeepingPanel() {
  const [unconfirmedDays, setUnconfirmedDays] = useState("30");
  const [inactiveDays, setInactiveDays] = useState("90");

  const [unconfirmed, setUnconfirmed] = useState<TaskState>(emptyTask());
  const [suppressed, setSuppressed] = useState<TaskState>(emptyTask());
  const [inactive, setInactive] = useState<TaskState>(emptyTask());

  async function preview(
    action: string,
    extra: Record<string, unknown>,
    setState: React.Dispatch<React.SetStateAction<TaskState>>
  ) {
    setState((s) => ({ ...s, loading: true, error: "", confirmed: false, result: null, preview: null }));
    try {
      const data = await callHousekeeping(action, { ...extra, dryRun: true });
      if (data?.error) {
        setState((s) => ({ ...s, loading: false, error: data.error }));
      } else {
        setState((s) => ({ ...s, loading: false, preview: data?.count ?? 0, confirmed: false }));
      }
    } catch {
      setState((s) => ({ ...s, loading: false, error: "Network error." }));
    }
  }

  async function confirm(
    action: string,
    extra: Record<string, unknown>,
    setState: React.Dispatch<React.SetStateAction<TaskState>>
  ) {
    setState((s) => ({ ...s, loading: true, error: "" }));
    try {
      const data = await callHousekeeping(action, { ...extra, dryRun: false });
      if (data?.error) {
        setState((s) => ({ ...s, loading: false, error: data.error }));
      } else {
        setState((s) => ({ ...s, loading: false, result: data?.deleted ?? 0, preview: null, confirmed: true }));
      }
    } catch {
      setState((s) => ({ ...s, loading: false, error: "Network error." }));
    }
  }

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-4 sm:p-5">
      <p className="text-xs font-semibold uppercase tracking-widest text-amber-400">Housekeeping</p>
      <h2 className="mt-1 text-base font-semibold text-white">List cleanup</h2>
      <p className="mt-1 text-xs text-zinc-500">Preview before deleting. Actions are irreversible.</p>

      <div className="mt-4 space-y-4">
        {/* Purge unconfirmed */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
          <p className="text-sm font-medium text-zinc-200">Unconfirmed subscribers</p>
          <p className="mt-0.5 text-xs text-zinc-500">Remove subscribers who never confirmed their email.</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label className="text-xs text-zinc-400">Older than</label>
            <input
              type="number"
              min={1}
              value={unconfirmedDays}
              onChange={(e) => setUnconfirmedDays(e.target.value)}
              className="w-16 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 outline-none focus:border-amber-400"
            />
            <span className="text-xs text-zinc-400">days</span>
            <button
              type="button"
              disabled={unconfirmed.loading}
              onClick={() => preview("purge_unconfirmed", { days: Number(unconfirmedDays) }, setUnconfirmed)}
              className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-zinc-500 disabled:opacity-60"
            >
              {unconfirmed.loading ? "Checking…" : "Preview"}
            </button>
            {unconfirmed.preview !== null && unconfirmed.result === null && (
              <button
                type="button"
                disabled={unconfirmed.loading}
                onClick={() => confirm("purge_unconfirmed", { days: Number(unconfirmedDays) }, setUnconfirmed)}
                className="rounded border border-red-800 bg-red-950/60 px-2 py-1 text-xs text-red-300 hover:border-red-600 disabled:opacity-60"
              >
                Delete {unconfirmed.preview} subscribers
              </button>
            )}
          </div>
          {unconfirmed.error && <p className="mt-1 text-xs text-red-400">{unconfirmed.error}</p>}
          {unconfirmed.result !== null && (
            <p className="mt-1 text-xs text-zinc-400">Deleted {unconfirmed.result} subscribers.</p>
          )}
        </div>

        {/* Purge suppressed */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
          <p className="text-sm font-medium text-zinc-200">Suppressed (bounced / complained)</p>
          <p className="mt-0.5 text-xs text-zinc-500">Permanently remove subscribers who hard bounced or reported spam.</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={suppressed.loading}
              onClick={() => preview("purge_suppressed", {}, setSuppressed)}
              className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-zinc-500 disabled:opacity-60"
            >
              {suppressed.loading ? "Checking…" : "Preview"}
            </button>
            {suppressed.preview !== null && suppressed.result === null && (
              <button
                type="button"
                disabled={suppressed.loading}
                onClick={() => confirm("purge_suppressed", {}, setSuppressed)}
                className="rounded border border-red-800 bg-red-950/60 px-2 py-1 text-xs text-red-300 hover:border-red-600 disabled:opacity-60"
              >
                Delete {suppressed.preview} subscribers
              </button>
            )}
          </div>
          {suppressed.error && <p className="mt-1 text-xs text-red-400">{suppressed.error}</p>}
          {suppressed.result !== null && (
            <p className="mt-1 text-xs text-zinc-400">Deleted {suppressed.result} subscribers.</p>
          )}
        </div>

        {/* Purge inactive */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
          <p className="text-sm font-medium text-zinc-200">Inactive subscribers</p>
          <p className="mt-0.5 text-xs text-zinc-500">Remove confirmed subscribers who have never opened any campaign email.</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label className="text-xs text-zinc-400">Signed up more than</label>
            <input
              type="number"
              min={1}
              value={inactiveDays}
              onChange={(e) => setInactiveDays(e.target.value)}
              className="w-16 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 outline-none focus:border-amber-400"
            />
            <span className="text-xs text-zinc-400">days ago</span>
            <button
              type="button"
              disabled={inactive.loading}
              onClick={() => preview("purge_inactive", { days: Number(inactiveDays) }, setInactive)}
              className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-zinc-500 disabled:opacity-60"
            >
              {inactive.loading ? "Checking…" : "Preview"}
            </button>
            {inactive.preview !== null && inactive.result === null && (
              <button
                type="button"
                disabled={inactive.loading}
                onClick={() => confirm("purge_inactive", { days: Number(inactiveDays) }, setInactive)}
                className="rounded border border-red-800 bg-red-950/60 px-2 py-1 text-xs text-red-300 hover:border-red-600 disabled:opacity-60"
              >
                Delete {inactive.preview} subscribers
              </button>
            )}
          </div>
          {inactive.error && <p className="mt-1 text-xs text-red-400">{inactive.error}</p>}
          {inactive.result !== null && (
            <p className="mt-1 text-xs text-zinc-400">Deleted {inactive.result} subscribers.</p>
          )}
        </div>
      </div>
    </section>
  );
}
