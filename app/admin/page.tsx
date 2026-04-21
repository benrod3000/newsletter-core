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

  return (
    <main className="min-h-screen bg-[#0d0d0d] px-6 py-12">
      <div className="mx-auto max-w-5xl">
        <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-amber-400">
          Admin
        </p>
        <h1 className="mb-1 text-3xl font-bold text-white">Subscribers</h1>
        <p className="mb-8 text-sm text-zinc-500">
          {subscribers.length} total &mdash; {confirmedCount} confirmed
        </p>

        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
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
        </div>

        {error && (
          <p className="mb-6 rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-400">
            Error loading subscribers: {error.message}
          </p>
        )}

        {role === "owner" && <ClientWorkspaceManager />}

        <AdminMailer
          totalCount={subscribers.length}
          confirmedCount={confirmedCount}
          subscribers={subscribers}
        />

        <SubscriberTable subscribers={subscribers} />
      </div>
    </main>
  );
}
