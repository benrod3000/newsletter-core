"use client";

import { useEffect, useState } from "react";

type Status = "idle" | "loading" | "success" | "error";
type EmbedStyle = "card" | "bar" | "minimal";

const PROFILE_FIELDS = ["first_name", "last_name", "date_of_birth", "job_title"] as const;
type ProfileField = (typeof PROFILE_FIELDS)[number];

function parseEmbedConfig() {
  const searchParams = new URLSearchParams(window.location.search);
  const styleParam = searchParams.get("style");
  const style: EmbedStyle = styleParam === "bar" || styleParam === "minimal" ? styleParam : "card";

  const fieldsParam = (searchParams.get("fields") || "").toLowerCase();
  const enabled = new Set<ProfileField>();
  for (const field of PROFILE_FIELDS) {
    if (fieldsParam.includes(field)) enabled.add(field);
  }

  return {
    style,
    enabledFields: enabled,
  };
}

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

export default function EmbedPage() {
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [embedStyle, setEmbedStyle] = useState<EmbedStyle>("card");
  const [enabledFields, setEnabledFields] = useState<Set<ProfileField>>(new Set());
  const [company, setCompany] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    document.body.classList.add("embed");
    const config = parseEmbedConfig();
    setEmbedStyle(config.style);
    setEnabledFields(config.enabledFields);
    return () => document.body.classList.remove("embed");
  }, []);

  function hasField(name: ProfileField) {
    return enabledFields.has(name);
  }

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
        body: JSON.stringify({
          email,
          company,
          first_name: firstName,
          last_name: lastName,
          date_of_birth: dateOfBirth,
          job_title: jobTitle,
          ...getClientContext(),
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

  const wrapperClass =
    embedStyle === "minimal"
      ? "w-full max-w-xl"
      : embedStyle === "bar"
        ? "w-full max-w-2xl"
        : "w-full max-w-md";

  const formClass =
    embedStyle === "bar"
      ? "flex flex-col gap-2 md:flex-row md:items-start"
      : "flex flex-col gap-2";

  const emailInputClass =
    embedStyle === "minimal"
      ? "w-full border-0 border-b border-white/50 bg-transparent px-0 py-2 text-sm text-white placeholder-white/60 outline-none focus:border-white"
      : "w-full rounded-lg border border-white/40 bg-white/20 px-4 py-3 text-sm text-white placeholder-white/60 outline-none transition focus:border-white focus:ring-1 focus:ring-white";

  const profileInputClass =
    embedStyle === "minimal"
      ? "w-full border-0 border-b border-white/40 bg-transparent px-0 py-2 text-sm text-white placeholder-white/60 outline-none focus:border-white"
      : "w-full rounded-lg border border-white/30 bg-white/15 px-3 py-2 text-sm text-white placeholder-white/60 outline-none transition focus:border-white";

  const buttonClass =
    embedStyle === "minimal"
      ? "rounded-md border border-white/70 px-4 py-2 text-sm font-bold text-white transition hover:bg-white/10 disabled:opacity-60"
      : "rounded-lg bg-white px-6 py-3 text-sm font-bold text-orange-500 transition hover:bg-white/90 active:scale-95 disabled:opacity-60 whitespace-nowrap";

  return (
    <div className="flex items-center justify-center bg-transparent p-4">
      <div className={wrapperClass}>
        {status !== "success" ? (
          <form onSubmit={handleSubmit} className={formClass}>
            <label htmlFor="embed-email" className="sr-only">
              Email address
            </label>
            <div className="flex-1 space-y-2">
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
                className={emailInputClass}
              />

              {enabledFields.size > 0 && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {hasField("first_name") && (
                    <input
                      type="text"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      placeholder="First name"
                      className={profileInputClass}
                    />
                  )}
                  {hasField("last_name") && (
                    <input
                      type="text"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      placeholder="Last name"
                      className={profileInputClass}
                    />
                  )}
                  {hasField("date_of_birth") && (
                    <input
                      type="date"
                      value={dateOfBirth}
                      onChange={(e) => setDateOfBirth(e.target.value)}
                      className={profileInputClass}
                    />
                  )}
                  {hasField("job_title") && (
                    <input
                      type="text"
                      value={jobTitle}
                      onChange={(e) => setJobTitle(e.target.value)}
                      placeholder="Job title"
                      className={profileInputClass}
                    />
                  )}
                </div>
              )}
            </div>
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
              className={buttonClass}
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
