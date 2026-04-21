import { getSupabaseClient } from "@/lib/supabase";

interface Subscriber {
  id: string;
  email: string;
  confirmed: boolean;
  country: string | null;
  region: string | null;
  city: string | null;
  created_at: string | null;
}

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("subscribers")
    .select("id, email, confirmed, country, region, city, created_at")
    .order("created_at", { ascending: false });

  const subscribers: Subscriber[] = data ?? [];
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

        <div className="overflow-x-auto rounded-lg border border-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900 text-left text-xs font-semibold uppercase tracking-wider text-zinc-500">
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Location</th>
                <th className="px-4 py-3">Signed up</th>
              </tr>
            </thead>
            <tbody>
              {subscribers.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-zinc-600">
                    No subscribers yet.
                  </td>
                </tr>
              ) : (
                subscribers.map((s) => (
                  <tr
                    key={s.id}
                    className="border-b border-zinc-800 last:border-0 hover:bg-zinc-900/60"
                  >
                    <td className="px-4 py-3 text-white">{s.email}</td>
                    <td className="px-4 py-3">
                      {s.confirmed ? (
                        <span className="rounded-full bg-emerald-900/60 px-2 py-0.5 text-xs font-medium text-emerald-400">
                          Confirmed
                        </span>
                      ) : (
                        <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs font-medium text-zinc-500">
                          Pending
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-zinc-400">
                      {[s.city, s.region, s.country].filter(Boolean).join(", ") || "—"}
                    </td>
                    <td className="px-4 py-3 text-zinc-500">
                      {s.created_at
                        ? new Date(s.created_at).toLocaleString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })
                        : "Unknown"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
