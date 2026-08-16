import { getSupabaseClient } from "@/lib/supabase";
import { fetchAllRows } from "@/lib/paginate";
import { headers } from "next/headers";
import AdminMailer from "./AdminMailer";
import ClientWorkspaceManager from "./ClientWorkspaceManager";
import SubscriberTable from "./SubscriberTable";
import DashboardNav from "./DashboardNav";
import ImportSubscribers from "./ImportSubscribers";
import HousekeepingPanel from "./HousekeepingPanel";
import { jsonString } from "@/lib/json";
import SubscriberListsPanel from "./SubscriberListsPanel";

export const dynamic = "force-dynamic";

function MetricCard({ label, value, change, icon }: { label: string; value: string | number; change?: string; icon: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">{label}</p>
          <p className="mt-2 text-2xl font-bold text-white">{value}</p>
          {change && <p className="mt-1 text-xs text-emerald-400">{change}</p>}
        </div>
        <div className="text-2xl">{icon}</div>
      </div>
    </div>
  );
}

export default async function AdminPage() {
  const requestHeaders = await headers();
  const role = requestHeaders.get("x-admin-role");
  const clientId = requestHeaders.get("x-admin-client-id");
  const username = requestHeaders.get("x-admin-username");

  const supabase = getSupabaseClient();
  /*
   * Paged, because every number on this page is derived from the result.
   *
   * This was a single unbounded select, which PostgREST silently caps at 1,000
   * rows. On a workspace with ten thousand subscribers the table showed a thousand
   * of them - tolerable on its own - but confirmedCount, pendingCount and
   * confirmationRate below are all computed by counting that same array, so the
   * headline figures described an arbitrary sample while presenting themselves as
   * totals. Worst of all, confirmedCount is handed to AdminMailer and shown to the
   * operator as the size of the audience they are about to send to.
   */
  const loadSubscribers = () =>
    fetchAllRows((afterId, pageSize) => {
      let q = supabase
        .from("subscribers")
        .select("id, email, confirmed, first_name, last_name, date_of_birth, phone_number, country, region, city, latitude, longitude, timezone, locale, utm_source, utm_medium, utm_campaign, referrer, landing_path, created_at")
        .order("id", { ascending: true })
        .limit(pageSize);

      if (role !== "owner" && clientId) {
        // `client_id` until the generated types caught it: migration 048 renamed
        // this column to `workspace_id` and this call site was missed. PostgREST
        // rejected the filter with 42703, so `data` came back null and a scoped
        // admin saw an empty list. Fails closed rather than leaking, but it was
        // broken from the tenancy rename until the types were turned on.
        q = q.eq("workspace_id", clientId);
      }
      if (afterId) q = q.gt("id", afterId);
      return q;
    });

  // Declared from the loader's own return type so the row shape stays inferred -
  // annotating it by hand here is what the components downstream depend on.
  let error: { message: string } | null = null;
  let baseSubscribers: Awaited<ReturnType<typeof loadSubscribers>> = [];

  try {
    baseSubscribers = await loadSubscribers();
  } catch (err) {
    error = { message: err instanceof Error ? err.message : String(err) };
  }

  // Keyset paging orders by id; the page wants newest first.
  baseSubscribers.sort((a, b) =>
    String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))
  );
  const subscriberIds = baseSubscribers.map((subscriber) => subscriber.id);

  // Batched for the same reason the subscriber query is paged: one `.in()` over
  // every subscriber returns at most 1,000 events however many ids it was given,
  // so lead_magnet_claimed was under-reported as soon as the list outgrew that.
  const claimedLeadMagnetIds = new Set<string>();
  const EVENT_BATCH = 200;
  for (let i = 0; i < subscriberIds.length; i += EVENT_BATCH) {
    const ids = subscriberIds.slice(i, i + EVENT_BATCH);
    const { data: clickEvents } = await supabase
      .from("campaign_events")
      .select("subscriber_id, metadata")
      .eq("event_type", "click")
      .in("subscriber_id", ids);

    for (const event of clickEvents ?? []) {
      if (event.subscriber_id && jsonString(event.metadata, "tracking_kind") === "lead_magnet") {
        claimedLeadMagnetIds.add(event.subscriber_id as string);
      }
    }
  }

  const subscribers = baseSubscribers.map((subscriber) => ({
    ...subscriber,
    lead_magnet_claimed: claimedLeadMagnetIds.has(subscriber.id),
  }));
  const confirmedCount = subscribers.filter((s) => s.confirmed).length;
  const claimedLeadMagnetCount = subscribers.filter((s) => s.lead_magnet_claimed).length;
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

      <main className="min-h-screen bg-gradient-to-b from-[#0d0d0d] to-[#1a1a1a] px-3 py-8 pt-32 sm:px-5 sm:py-10 sm:pt-36 lg:px-6">
        <div className="mx-auto w-full max-w-7xl">
          {/* Header Section */}
          <div className="mb-6">
            <div className="mb-6 flex items-end justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-amber-400/80">Dashboard</p>
                <h1 className="mt-2 text-4xl font-bold text-white">Newsletter Hub</h1>
                <p className="mt-1 text-sm text-zinc-400">Manage campaigns, subscribers, and lists all in one place</p>
              </div>
              <div className="hidden text-right sm:block">
                <p className="text-xs uppercase tracking-wider text-zinc-600">Account</p>
                <p className="font-semibold text-zinc-200">{username || "Admin"}</p>
                <p className="mt-0.5 text-xs text-zinc-500 capitalize">{role} access</p>
              </div>
            </div>

            {error && (
              <div className="rounded-lg border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-400">
                ⚠️ Error loading subscribers: {error.message}
              </div>
            )}
          </div>

          {/* Key Metrics Section */}
          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="Total Subscribers"
              value={subscribers.length.toLocaleString()}
              icon="👥"
            />
            <MetricCard
              label="Confirmed"
              value={confirmedCount}
              change={`${confirmationRate}% confirmed`}
              icon="✓"
            />
            <MetricCard
              label="Pending"
              value={pendingCount}
              icon="⏳"
            />
            <MetricCard
              label="Claimed Offer"
              value={claimedLeadMagnetCount}
              change={subscribers.length > 0 ? `${Math.round((claimedLeadMagnetCount / subscribers.length) * 100)}% of total` : "0%"}
              icon="🎁"
            />
          </div>

          {/* Quick Actions Section */}
          <div className="mb-6 rounded-lg border border-zinc-800 bg-zinc-900/50 p-6">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-300">Quick Actions</h2>
            <div className="flex flex-wrap gap-3">
              <a href="#campaigns" className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-black hover:bg-amber-400 transition">
                ✉️ Create Campaign
              </a>
              <a href="#lists" className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-200 hover:border-zinc-600 hover:bg-zinc-800/50 transition">
                📋 New List
              </a>
              <a href="#import" className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-200 hover:border-zinc-600 hover:bg-zinc-800/50 transition">
                📥 Import Subscribers
              </a>
              <a href="#subscribers" className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-200 hover:border-zinc-600 hover:bg-zinc-800/50 transition">
                🔍 View Subscribers
              </a>
            </div>
          </div>

          {/* Main Content Grid */}
          <div className="grid gap-6 lg:grid-cols-10 lg:items-start">
            {/* Sidebar - Left Column */}
            <div className="space-y-6 lg:col-span-3">
              {/* Workspaces Section */}
              {role === "owner" && (
                <div id="workspaces" className="scroll-mt-40">
                  <ClientWorkspaceManager />
                </div>
              )}

              {/* Subscribers Section */}
              <div id="subscribers" className="scroll-mt-40">
                <SubscriberTable subscribers={subscribers} />
              </div>

              {/* Import Section */}
              <div id="import" className="scroll-mt-40">
                <ImportSubscribers />
              </div>

              {/* Lists Section */}
              <div id="lists" className="scroll-mt-40">
                <SubscriberListsPanel />
              </div>



              {/* Housekeeping Section */}
              {role === "owner" && (
                <div id="housekeeping" className="scroll-mt-40">
                  <HousekeepingPanel />
                </div>
              )}
            </div>

            {/* Main Content - Right Column */}
            <div id="campaigns" className="scroll-mt-40 lg:col-span-7">
              <AdminMailer
                totalCount={subscribers.length}
                confirmedCount={confirmedCount}
                claimedLeadMagnetCount={claimedLeadMagnetCount}
                subscribers={subscribers}
              />
            </div>
          </div>

          {/* Footer Section */}
          <div className="mt-16 border-t border-zinc-800 pt-8 text-center">
            <p className="text-xs text-zinc-600">
              Elite newsletter platform • Built for agencies and high-performance teams
            </p>
          </div>
        </div>
      </main>
    </>
  );
}
