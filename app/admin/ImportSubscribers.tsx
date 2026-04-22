"use client";

import { useRef, useState } from "react";

interface ImportResult {
  processed: number;
  skipped: number;
  skippedDetails?: string[];
}

export default function ImportSubscribers() {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [markConfirmed, setMarkConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState("");

  function downloadTemplate() {
    const csv =
      "email,first_name,last_name,date_of_birth,job_title,country,region,city,timezone,locale,utm_source,utm_medium,utm_campaign\n" +
      "example@email.com,Alex,Rivera,1992-08-14,Product Manager,US,California,Los Angeles,America/Los_Angeles,en-US,newsletter,email,spring2026\n";
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "import-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImport() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Please select a CSV file.");
      return;
    }
    setLoading(true);
    setError("");
    setResult(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("confirmed", String(markConfirmed));

      const res = await fetch("/api/admin/subscribers/import", {
        method: "POST",
        body: formData,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? "Import failed.");
      } else {
        setResult(data);
        if (fileRef.current) fileRef.current.value = "";
      }
    } catch {
      setError("Network error during import.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-4 sm:p-5">
      <p className="text-xs font-semibold uppercase tracking-widest text-amber-400">Import</p>
      <h2 className="mt-1 text-base font-semibold text-white">Bulk import subscribers</h2>
      <p className="mt-1 text-xs text-zinc-500">
        Upload a CSV with an <code className="text-zinc-300">email</code> column. Optional profile fields: <code className="text-zinc-300">first_name</code>, <code className="text-zinc-300">last_name</code>, <code className="text-zinc-300">date_of_birth</code>, <code className="text-zinc-300">job_title</code>.
      </p>

      <div className="mt-4 space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-zinc-500">
            CSV file
          </label>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 file:mr-3 file:rounded file:border-0 file:bg-zinc-700 file:px-2 file:py-1 file:text-xs file:text-zinc-200"
          />
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
          <input
            type="checkbox"
            checked={markConfirmed}
            onChange={(e) => setMarkConfirmed(e.target.checked)}
            className="rounded border-zinc-600 bg-zinc-800 text-amber-400 focus:ring-amber-400"
          />
          Mark imported subscribers as confirmed
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleImport}
            disabled={loading}
            className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-black hover:bg-amber-300 disabled:opacity-60"
          >
            {loading ? "Importing…" : "Import"}
          </button>
          <button
            type="button"
            onClick={downloadTemplate}
            className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:border-zinc-500"
          >
            Download template
          </button>
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        {result && (
          <div className="rounded-lg border border-zinc-700 bg-zinc-950/60 p-3 text-sm">
            <p className="text-zinc-200">
              <span className="font-semibold text-amber-400">{result.processed}</span> subscriber
              {result.processed !== 1 ? "s" : ""} imported
              {result.skipped > 0 && (
                <span className="text-zinc-400">, {result.skipped} row{result.skipped !== 1 ? "s" : ""} skipped</span>
              )}
              .
            </p>
            {result.skippedDetails && result.skippedDetails.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-xs text-zinc-500">
                {result.skippedDetails.map((msg, i) => (
                  <li key={i}>{msg}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
