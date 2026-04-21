import { getSupabaseClient } from "@/lib/supabase";
import { headers } from "next/headers";
import AdminMailer from "./AdminMailer";
import ClientWorkspaceManager from "./ClientWorkspaceManager";
import SubscriberTable from "./SubscriberTable";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const requestHeaders = await headers();
  const role = requestHeaders.get("x-admin-role");
  const clientId = requestHeaders.get("x-admin-client-id");
  const username = requestHeaders.get("x-admin-username");

  const supabase = getSupabaseClient();
  let query = supabase
    .from("subscribers")
    .select("id, email, confirmed, country, region, city, timezone, locale, utm_source, utm_medium, utm_campaign, referrer, landing_path, created_at")
    .order("created_at", { ascending: false });

  if (role !== "owner" && clientId) {
    query = query.eq("client_id", clientId);
  }

  const { data, error } = await query;

  const subscribers = data ?? [];
  const confirmedCount = subscribers.filter((s) => s.confirmed).length;
  const pendingCount = subscribers.length - confirmedCount;
  const confirmationRate = subscribers.length > 0 ? Math.round((confirmedCount / subscribers.length) * 100) : 0;

  return (
    <main className="min-h-screen bg-[#0d0d0d] px-4 py-8 sm:px-6 sm:py-10">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 rounded-xl border border-zinc-800 bg-zinc-950/85 px-4 py-4 sm:px-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-amber-400">Admin</p>
          <h1 className="mt-1 text-2xl font-bold text-white sm:text-3xl">Dashboard</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Signed in as {username || "admin"} ({role || "unknown"})
          </p>
        </div>

        {error && (
          <p className="mb-6 rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-400">
            Error loading subscribers: {error.message}
          </p>
        )}

        <div className="grid gap-6 xl:grid-cols-[280px,1fr]">
          <aside className="space-y-4 xl:sticky xl:top-4 xl:self-start">
            <nav className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-zinc-500">Quick jump</p>
              <div className="flex flex-col gap-2 text-sm">
                <a href="#campaigns" className="rounded-md border border-zinc-700 px-3 py-2 text-zinc-300 hover:border-zinc-500 hover:text-white">Campaigns</a>
                {role === "owner" && (
                  <a href="#workspaces" className="rounded-md border border-zinc-700 px-3 py-2 text-zinc-300 hover:border-zinc-500 hover:text-white">Workspaces</a>
                )}
                <a href="#subscribers" className="rounded-md border border-zinc-700 px-3 py-2 text-zinc-300 hover:border-zinc-500 hover:text-white">Subscribers</a>
              </div>
            </nav>

            <div className="space-y-2">
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 px-4 py-3">
                <p className="text-xs uppercase tracking-wider text-zinc-500">Total</p>
                <p className="mt-1 text-2xl font-semibold text-white">{subscribers.length}</p>
              </div>
              <div className="rounded-lg border border-emerald-900/50 bg-emerald-950/30 px-4 py-3">
                <p className="text-xs uppercase tracking-wider text-emerald-500">Confirmed</p>
                <p className="mt-1 text-2xl font-semibold text-emerald-300">{confirmedCount}</p>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 px-4 py-3">
                <p className="text-xs uppercase tracking-wider text-zinc-500">Pending</p>
                <p className="mt-1 text-2xl font-semibold text-zinc-300">{pendingCount}</p>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 px-4 py-3">
                <p className="text-xs uppercase tracking-wider text-zinc-500">Confirm rate</p>
                <p className="mt-1 text-2xl font-semibold text-amber-300">{confirmationRate}%</p>
              </div>
            </div>
          </aside>

          <div className="space-y-6">
            {role === "owner" && (
              <div id="workspaces" className="scroll-mt-24">
                <ClientWorkspaceManager />
              </div>
            )}

            <div id="campaigns" className="scroll-mt-24">
              <AdminMailer
                totalCount={subscribers.length}
                confirmedCount={confirmedCount}
                subscribers={subscribers}
              />
            </div>

            <div id="subscribers" className="scroll-mt-24">
              <SubscriberTable subscribers={subscribers} />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
