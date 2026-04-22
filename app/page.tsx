"use client";

import { useState, useEffect } from "react";

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

async function requestBrowserGeolocation(): Promise<{ latitude: number; longitude: number } | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
      },
      () => {
        // User denied permission or error occurred, fallback to server-side geolocation
        resolve(null);
      },
      { timeout: 5000 }
    );
  });
}

export default function Home() {
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [trackingConsent, setTrackingConsent] = useState(false);
  const [browserGeo, setBrowserGeo] = useState<{ latitude: number; longitude: number } | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");

  // Request geolocation on mount
  useEffect(() => {
    requestBrowserGeolocation().then((geo) => {
      if (geo) {
        setBrowserGeo(geo);
      }
    });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setStatus("error");
      setMessage("Please enter a valid email address.");
      return;
    }
    if (!marketingConsent || !trackingConsent) {
      setStatus("error");
      setMessage("Please confirm email and analytics consent before joining.");
      return;
    }

    setStatus("loading");
    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          first_name: firstName,
          last_name: lastName,
          date_of_birth: dateOfBirth,
          phone_number: phoneNumber,
          consent_email_marketing: marketingConsent,
          consent_analytics_tracking: trackingConsent,
          ...getClientContext(),
          // Include browser geolocation if available (will override server IP geo if more accurate)
          browser_latitude: browserGeo?.latitude,
          browser_longitude: browserGeo?.longitude,
        }),
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
          <form onSubmit={handleSubmit} className="space-y-3">
            <label htmlFor="email" className="sr-only">
              Email address
            </label>
            <div className="flex flex-col gap-3 sm:flex-row">
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
            </div>

            <details className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2">
              <summary className="cursor-pointer list-none text-xs font-medium uppercase tracking-wider text-zinc-400">
                Optional profile fields
              </summary>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <input
                  id="first-name"
                  name="first_name"
                  type="text"
                  autoComplete="given-name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="First name"
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 outline-none focus:border-amber-400"
                />
                <input
                  id="last-name"
                  name="last_name"
                  type="text"
                  autoComplete="family-name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Last name"
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 outline-none focus:border-amber-400"
                />
                <input
                  id="phone-number"
                  name="tel"
                  type="tel"
                  autoComplete="tel"
                  inputMode="tel"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="Phone number"
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 outline-none focus:border-amber-400"
                />
                <label className="block text-xs text-zinc-400">
                  <span className="mb-1 block" id="birthday-label">Birthday</span>
                  <input
                    id="birthday"
                    name="birthday"
                    type="text"
                    autoComplete="bday"
                    aria-labelledby="birthday-label"
                    value={dateOfBirth}
                    onChange={(e) => setDateOfBirth(e.target.value)}
                    inputMode="numeric"
                    placeholder="MM/DD/YYYY"
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 outline-none focus:border-amber-400"
                  />
                  <span className="mt-1 block text-[11px] text-zinc-500">Optional. Share your birthday for birthday campaigns and offers.</span>
                </label>
              </div>
            </details>

            <div className="space-y-1.5 text-xs text-zinc-400">
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={marketingConsent}
                  onChange={(e) => setMarketingConsent(e.target.checked)}
                  className="mt-1 rounded border-zinc-600 bg-zinc-800 text-amber-400 focus:ring-amber-400"
                />
                <span className="leading-snug">
                  I agree to marketing emails and can unsubscribe anytime
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={trackingConsent}
                  onChange={(e) => setTrackingConsent(e.target.checked)}
                  className="mt-1 rounded border-zinc-600 bg-zinc-800 text-amber-400 focus:ring-amber-400"
                />
                <span className="leading-snug">
                  I agree to tracking as described in the <a href="/privacy" className="text-amber-400 underline underline-offset-2 hover:text-amber-300">privacy notice</a>
                </span>
              </label>
            </div>
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
          No spam. No sharing. Unsubscribe any time. Read our <a href="/privacy" className="text-amber-400 underline underline-offset-2 hover:text-amber-300">privacy notice</a>.
        </p>
      </div>
    </main>
  );
}
