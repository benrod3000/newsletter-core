import { getSupabaseClient } from "@/lib/supabase";
import { headers } from "next/headers";
import AdminMailer from "./AdminMailer";
import ClientWorkspaceManager from "./ClientWorkspaceManager";
import SubscriberTable from "./SubscriberTable";
import DashboardNav from "./DashboardNav";
import ImportSubscribers from "./ImportSubscribers";
import HousekeepingPanel from "./HousekeepingPanel";
import EmbedCodePanel from "./EmbedCodePanel";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const requestHeaders = await headers();
  const role = requestHeaders.get("x-admin-role");
  const clientId = requestHeaders.get("x-admin-client-id");
  const username = requestHeaders.get("x-admin-username");

  const supabase = getSupabaseClient();
  let query = supabase
    .from("subscribers")
    .select("id, email, confirmed, first_name, last_name, date_of_birth, phone_number, country, region, city, latitude, longitude, timezone, locale, utm_source, utm_medium, utm_campaign, referrer, landing_path, created_at")
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

      <main className="min-h-screen bg-[#0d0d0d] px-3 py-8 pt-32 sm:px-4 sm:py-10 sm:pt-36 lg:px-5">
        <div className="mx-auto w-full max-w-none">
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

          <div className="grid gap-8 sm:grid-cols-10 sm:items-start">
            {/* Left Column */}
            <div className="min-w-0 space-y-8 sm:col-span-4">
              {role === "owner" && (
                <div id="workspaces" className="scroll-mt-40">
                  <ClientWorkspaceManager />
                </div>
              )}

              <div id="subscribers" className="scroll-mt-40">
                <SubscriberTable subscribers={subscribers} />
              </div>

              <div id="import" className="scroll-mt-40">
                <ImportSubscribers />
              </div>

              <div id="embed" className="scroll-mt-40">
                <EmbedCodePanel />
              </div>

              {role === "owner" && (
                <div id="housekeeping" className="scroll-mt-40">
                  <HousekeepingPanel />
                </div>
              )}
            </div>

            {/* Right Column */}
            <div id="campaigns" className="min-w-0 scroll-mt-40 sm:col-span-6">
              <AdminMailer
                totalCount={subscribers.length}
                confirmedCount={confirmedCount}
                subscribers={subscribers}
              />
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
