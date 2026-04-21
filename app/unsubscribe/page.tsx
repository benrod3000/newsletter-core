"use client";

import { useSearchParams } from "next/navigation";
import { useState, Suspense } from "react";

function UnsubscribeForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  async function handleUnsubscribe() {
    if (!token) {
      setStatus("error");
      setMessage("Missing or invalid unsubscribe token.");
      return;
    }
    setStatus("loading");
    try {
      const res = await fetch("/api/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (res.ok) {
        setStatus("done");
      } else {
        const data = await res.json();
        setStatus("error");
        setMessage(data.error ?? "Something went wrong.");
      }
    } catch {
      setStatus("error");
      setMessage("Network error. Please try again.");
    }
  }

  if (status === "done") {
    return (
      <div className="rounded-lg border border-zinc-700 bg-zinc-900 px-6 py-5">
        <p className="text-sm font-medium text-amber-400">You&apos;ve been unsubscribed.</p>
        <p className="mt-1 text-xs text-zinc-500">Sorry to see you go. You won&apos;t hear from us again.</p>
      </div>
    );
  }

  return (
    <>
      <p className="mt-5 text-lg leading-relaxed text-zinc-400">
        Click below to remove your email from the list. This can&apos;t be undone.
      </p>
      <div className="my-8 h-px w-16 bg-zinc-700" />
      <button
        onClick={handleUnsubscribe}
        disabled={status === "loading" || !token}
        className="rounded-lg bg-zinc-700 px-6 py-3 text-sm font-bold text-white transition hover:bg-zinc-600 active:scale-95 disabled:opacity-60"
      >
        {status === "loading" ? "Unsubscribing…" : "Yes, unsubscribe me"}
      </button>
      {status === "error" && (
        <p className="mt-3 text-xs text-red-400">{message}</p>
      )}
    </>
  );
}

export default function UnsubscribePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 bg-[#0d0d0d]">
      <div className="w-full max-w-xl">
        <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-amber-400">
          Newsletter Services
        </p>
        <h1 className="text-5xl font-bold leading-tight tracking-tight text-white">
          Unsubscribe
        </h1>
        <Suspense fallback={<p className="mt-5 text-zinc-400">Loading…</p>}>
          <UnsubscribeForm />
        </Suspense>
        <p className="mt-6 text-xs text-zinc-600">
          Changed your mind?{" "}
          <a href="/" className="text-amber-400 underline underline-offset-4 hover:text-amber-300">
            Re-subscribe
          </a>
        </p>
      </div>
    </main>
  );
}
