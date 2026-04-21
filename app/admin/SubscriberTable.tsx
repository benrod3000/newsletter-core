"use client";

import { useState, useMemo } from "react";

interface Subscriber {
  id: string;
  email: string;
  confirmed: boolean;
  country: string | null;
  region: string | null;
  city: string | null;
  timezone: string | null;
  locale: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  referrer: string | null;
  landing_path: string | null;
  created_at: string | null;
}

const ADMIN_TIME_ZONE = "America/Los_Angeles";

function formatSignupTime(value: string | null) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: ADMIN_TIME_ZONE,
    timeZoneName: "short",
  }).format(date);
}

function unique(values: (string | null)[]): string[] {
  return Array.from(new Set(values.filter((v): v is string => Boolean(v)))).sort();
}

function escapeCsv(value: string | null | boolean): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function exportToCsv(rows: Subscriber[], filename: string) {
  const headers = ["email", "confirmed", "country", "region", "city", "timezone", "locale", "utm_source", "utm_medium", "utm_campaign", "referrer", "landing_path", "created_at"];
  const lines = [
    headers.join(","),
    ...rows.map((s) =>
      [
        s.email, s.confirmed, s.country, s.region, s.city,
        s.timezone, s.locale, s.utm_source, s.utm_medium,
        s.utm_campaign, s.referrer, s.landing_path, s.created_at,
      ]
        .map(escapeCsv)
        .join(",")
    ),
  ];

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function SubscriberTable({ subscribers }: { subscribers: Subscriber[] }) {
  const [statusFilter, setStatusFilter] = useState<"all" | "confirmed" | "pending">("all");
  const [countryFilter, setCountryFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [search, setSearch] = useState("");

  const countries = useMemo(() => unique(subscribers.map((s) => s.country)), [subscribers]);
  const sources = useMemo(() => unique(subscribers.map((s) => s.utm_source)), [subscribers]);

  const filtered = useMemo(() => {
    return subscribers.filter((s) => {
      if (statusFilter === "confirmed" && !s.confirmed) return false;
      if (statusFilter === "pending" && s.confirmed) return false;
      if (countryFilter && s.country !== countryFilter) return false;
      if (sourceFilter && s.utm_source !== sourceFilter) return false;
      if (search && !s.email.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [subscribers, statusFilter, countryFilter, sourceFilter, search]);

  const hasFilters = statusFilter !== "all" || countryFilter || sourceFilter || search;

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-amber-400">Subscribers</p>
          <h2 className="mt-1 text-lg font-semibold text-white">Audience list</h2>
          <p className="mt-1 text-sm text-zinc-500">Filter, inspect attribution, and export subscriber data.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setStatusFilter("all")}
            className={`rounded-full border px-3 py-1.5 text-xs ${
              statusFilter === "all" ? "border-amber-400 text-amber-300" : "border-zinc-700 text-zinc-400 hover:border-zinc-500"
            }`}
          >
            All
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter("confirmed")}
            className={`rounded-full border px-3 py-1.5 text-xs ${
              statusFilter === "confirmed" ? "border-emerald-500 text-emerald-300" : "border-zinc-700 text-zinc-400 hover:border-zinc-500"
            }`}
          >
            Confirmed
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter("pending")}
            className={`rounded-full border px-3 py-1.5 text-xs ${
              statusFilter === "pending" ? "border-zinc-500 text-zinc-200" : "border-zinc-700 text-zinc-400 hover:border-zinc-500"
            }`}
          >
            Pending
          </button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <input
          type="search"
          placeholder="Search email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-white placeholder-zinc-500 outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400"
        />

        {countries.length > 0 && (
          <select
            value={countryFilter}
            onChange={(e) => setCountryFilter(e.target.value)}
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-300 outline-none focus:border-amber-400"
          >
            <option value="">All countries</option>
            {countries.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        )}

        {sources.length > 0 && (
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-300 outline-none focus:border-amber-400"
          >
            <option value="">All sources</option>
            {sources.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        )}

        {hasFilters && (
          <button
            onClick={() => {
              setStatusFilter("all");
              setCountryFilter("");
              setSourceFilter("");
              setSearch("");
            }}
            className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-500 hover:border-zinc-500 hover:text-zinc-300"
          >
            Clear filters
          </button>
        )}

        <span className="ml-auto self-center text-xs text-zinc-600">
          {filtered.length} of {subscribers.length}
        </span>

        <button
          onClick={() => {
            const timestamp = new Date().toISOString().slice(0, 10);
            const label = filtered.length < subscribers.length ? "filtered" : "all";
            exportToCsv(filtered, `subscribers-${label}-${timestamp}.csv`);
          }}
          className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:border-amber-400 hover:text-amber-400 transition-colors"
        >
          Export CSV
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 bg-zinc-900 text-left text-xs font-semibold uppercase tracking-wider text-zinc-500">
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Location</th>
              <th className="px-4 py-3">Timezone</th>
              <th className="px-4 py-3">Source</th>
              <th className="px-4 py-3">Signed up</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-zinc-600">
                  No subscribers match the current filters.
                </td>
              </tr>
            ) : (
              filtered.map((s) => (
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
                    {s.timezone || s.locale || "—"}
                  </td>
                  <td className="px-4 py-3 text-zinc-500">
                    {[s.utm_source, s.utm_medium, s.utm_campaign].filter(Boolean).join(" / ") ||
                      s.landing_path ||
                      s.referrer ||
                      "—"}
                  </td>
                  <td className="px-4 py-3 text-zinc-500">{formatSignupTime(s.created_at)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
