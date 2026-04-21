"use client";

import { useState } from "react";

type Status = "idle" | "loading" | "success" | "error";

function getClientContext() {
  const searchParams = new URLSearchParams(window.location.search);

  return {
    client_slug: searchParams.get("client"),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    locale: navigator.language,
    utm_source: searchParams.get("utm_source"),
    utm_medium: searchParams.get("utm_medium"),
    utm_campaign: searchParams.get("utm_campaign"),
    referrer: document.referrer || null,
    landing_path: window.location.pathname + window.location.search,
  };
}

export default function Home() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setStatus("error");
      setMessage("Please enter a valid email address.");
      return;
    }

    setStatus("loading");
    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, ...getClientContext() }),
      });

      const data = await res.json();
      if (!res.ok) {
        setStatus("error");
        setMessage(data.error ?? "Something went wrong. Try again.");
      } else {
        setStatus("success");
        if (data?.emailSent === false) {
          setMessage(data.warning ?? "Signup saved, but confirmation email failed to send.");
        } else if (data?.resent) {
          setMessage("Confirmation email re-sent. Check your inbox.");
        } else if (data?.alreadyConfirmed) {
          setMessage("This email is already confirmed.");
        } else {
          setMessage("");
        }
      }
    } catch {
      setStatus("error");
      setMessage("Network error. Please try again.");
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 bg-[#0d0d0d]">
      <div className="w-full max-w-xl">
        {/* Eyebrow */}
        <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-amber-400">
          Newsletter Services
        </p>

        {/* Headline */}
        <h1 className="text-5xl font-bold leading-tight tracking-tight text-white sm:text-6xl">
          Attention{" "}
          <span className="text-amber-400">→</span>{" "}
          Ownership
        </h1>

        {/* Subheadline */}
        <p className="mt-5 text-lg leading-relaxed text-zinc-400">
          Most newsletters rent their audience. This one is built to own it.
          <br />
          Strategy, systems, and signals — delivered weekly.
        </p>

        {/* Divider */}
        <div className="my-8 h-px w-16 bg-zinc-700" />

        {/* Form */}
        {status !== "success" ? (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row">
            <label htmlFor="email" className="sr-only">
              Email address
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (status === "error") setStatus("idle");
              }}
              placeholder="your@email.com"
              className="w-full flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm text-white placeholder-zinc-500 outline-none transition focus:border-amber-400 focus:ring-1 focus:ring-amber-400"
            />
            <button
              type="submit"
              disabled={status === "loading"}
              className="rounded-lg bg-amber-400 px-6 py-3 text-sm font-bold text-black transition hover:bg-amber-300 active:scale-95 disabled:opacity-60"
            >
              {status === "loading" ? "Joining…" : "Join the list"}
            </button>
          </form>
        ) : (
          <div className="rounded-lg border border-zinc-700 bg-zinc-900 px-6 py-5">
            <p className="text-sm font-medium text-amber-400">
              You&apos;re in. Check your inbox to confirm.
            </p>
            <p className="mt-1 text-xs text-zinc-500">{message || "Welcome to the system."}</p>
          </div>
        )}

        {status === "error" && (
          <p className="mt-2 text-xs text-red-400">{message}</p>
        )}

        {/* Fine print */}
        <p className="mt-6 text-xs text-zinc-600">
          No spam. No sharing. Unsubscribe any time.
        </p>
      </div>
    </main>
  );
}
