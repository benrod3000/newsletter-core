import { getSupabaseClient } from "@/lib/supabase";
import { headers } from "next/headers";
import AdminMailer from "./AdminMailer";
import ClientWorkspaceManager from "./ClientWorkspaceManager";
import SubscriberTable from "./SubscriberTable";
import DashboardNav from "./DashboardNav";

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
    <>
      <DashboardNav
        role={role}
        totalCount={subscribers.length}
        confirmedCount={confirmedCount}
        confirmationRate={confirmationRate}
      />

      <main className="min-h-screen bg-[#0d0d0d] px-4 py-8 pt-32 sm:px-6 sm:py-10 sm:pt-36">
        <div className="mx-auto max-w-4xl">
          <div className="mb-8 rounded-xl border border-zinc-800 bg-zinc-950/85 px-4 py-4 sm:px-5">
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

          <div className="space-y-8">
            {role === "owner" && (
              <div id="workspaces" className="scroll-mt-40">
                <ClientWorkspaceManager />
              </div>
            )}

            <div id="campaigns" className="scroll-mt-40">
              <AdminMailer
                totalCount={subscribers.length}
                confirmedCount={confirmedCount}
                subscribers={subscribers}
              />
            </div>

            <div id="subscribers" className="scroll-mt-40">
              <SubscriberTable subscribers={subscribers} />
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
