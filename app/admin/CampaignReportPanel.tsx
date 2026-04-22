"use client";

interface CampaignStats {
  opens: number;
  clicks: number;
  bounces: number;
  complaints: number;
  unsubscribes: number;
  openRate: number;
  clickRate: number;
}

interface TopUrl {
  url: string;
  count: number;
}

interface TopCity {
  city: string;
  count: number;
}

interface ReportData {
  campaign: { id: string; title: string; subject: string; sentCount: number; lastSentAt: string | null };
  stats: CampaignStats;
  topUrls: TopUrl[];
  topCities: TopCity[];
}

interface Props {
  report: ReportData | null;
  loading: boolean;
}

export default function CampaignReportPanel({ report, loading }: Props) {
  if (loading) {
    return <p className="py-3 text-xs text-zinc-500">Loading stats…</p>;
  }
  if (!report) {
    return <p className="py-3 text-xs text-zinc-500">No data yet.</p>;
  }

  const { stats, topUrls, topCities } = report;

  const statItems = [
    { label: "Sent", value: report.campaign.sentCount, note: "" },
    { label: "Opens", value: stats.opens, note: `${stats.openRate}%` },
    { label: "Clicks", value: stats.clicks, note: `${stats.clickRate}%` },
    { label: "Bounces", value: stats.bounces, note: "" },
    { label: "Complaints", value: stats.complaints, note: "" },
    { label: "Unsubs", value: stats.unsubscribes, note: "" },
  ];

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-3">
      <div className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
        {statItems.map((item) => (
          <div key={item.label} className="rounded border border-zinc-800 bg-zinc-900 px-2 py-2 text-center">
            <p className="text-base font-bold text-white leading-none">{item.value}</p>
            {item.note && <p className="mt-0.5 text-xs text-amber-400">{item.note}</p>}
            <p className="mt-1 text-xs uppercase tracking-wider text-zinc-500">{item.label}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {topUrls.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-500">Top clicked links</p>
            <ul className="space-y-1">
              {topUrls.map((item) => (
                <li key={item.url} className="flex items-center gap-2 text-xs">
                  <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-amber-300">{item.count}</span>
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="truncate text-zinc-400 hover:text-zinc-200 max-w-xs"
                  >
                    {item.url}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        {topCities.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-500">Clicks by city</p>
            <ul className="space-y-1">
              {topCities.map((item) => (
                <li key={item.city} className="flex items-center gap-2 text-xs text-zinc-400">
                  <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-amber-300">{item.count}</span>
                  <span className="truncate">{item.city}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
