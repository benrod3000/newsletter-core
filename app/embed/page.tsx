"use client";

import { useEffect, useState } from "react";

type Status = "idle" | "loading" | "success" | "error";

function getClientContext() {
  const searchParams = new URLSearchParams(window.location.search);

  return {
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    locale: navigator.language,
    utm_source: searchParams.get("utm_source"),
    utm_medium: searchParams.get("utm_medium"),
    utm_campaign: searchParams.get("utm_campaign"),
    referrer: document.referrer || null,
    landing_path: window.location.pathname + window.location.search,
  };
}

export default function EmbedPage() {
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    document.body.classList.add("embed");
    return () => document.body.classList.remove("embed");
  }, []);

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
        body: JSON.stringify({ email, company, ...getClientContext() }),
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
    <div className="flex items-center justify-center bg-transparent p-4">
      <div className="w-full max-w-md">
        {status !== "success" ? (
          <form onSubmit={handleSubmit} className="flex flex-col gap-2 sm:flex-row">
            <label htmlFor="embed-email" className="sr-only">
              Email address
            </label>
            <input
              id="embed-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (status === "error") setStatus("idle");
              }}
              placeholder="your@email.com"
              className="w-full flex-1 rounded-lg border border-white/40 bg-white/20 px-4 py-3 text-sm text-white placeholder-white/60 outline-none transition focus:border-white focus:ring-1 focus:ring-white"
            />
            <label htmlFor="embed-company" className="sr-only">
              Company
            </label>
            <input
              id="embed-company"
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              className="hidden"
              aria-hidden="true"
            />
            <button
              type="submit"
              disabled={status === "loading"}
              className="rounded-lg bg-white px-6 py-3 text-sm font-bold text-orange-500 transition hover:bg-white/90 active:scale-95 disabled:opacity-60 whitespace-nowrap"
            >
              {status === "loading" ? "Joining…" : "Join the list"}
            </button>
          </form>
        ) : (
          <div className="rounded-lg border border-white/40 bg-white/20 px-6 py-4">
            <p className="text-sm font-medium text-white">
              You&apos;re in. Check your inbox to confirm.
            </p>
            <p className="mt-1 text-xs text-white/60">{message || "Welcome to the system."}</p>
          </div>
        )}

        {status === "error" && (
          <p className="mt-2 text-xs text-white/80">{message}</p>
        )}

        <p className="mt-3 text-xs text-white/50">
          No spam. No sharing. Unsubscribe any time.
        </p>
      </div>
    </div>
  );
}
