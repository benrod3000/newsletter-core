"use client";

import { useEffect, useState } from "react";

type Status = "idle" | "loading" | "success" | "error";
type EmbedStyle = "card" | "bar" | "minimal";

type EmbedTheme = {
  accent: string;
  bg: string;
  text: string;
  inputBg: string;
};

const PROFILE_FIELDS = ["first_name", "last_name", "date_of_birth", "phone_number"] as const;
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

  const defaultTheme: EmbedTheme = {
    accent: "#ff7a18",
    bg: "#1a0f0a",
    text: "#fff3e8",
    inputBg: "#2a1710",
  };

  const theme: EmbedTheme = {
    accent: searchParams.get("accent") || defaultTheme.accent,
    bg: searchParams.get("bg") || defaultTheme.bg,
    text: searchParams.get("text") || defaultTheme.text,
    inputBg: searchParams.get("input_bg") || defaultTheme.inputBg,
  };

  return {
    style,
    enabledFields: enabled,
    theme,
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
    lead_title: searchParams.get("lead_title"),
    lead_url: searchParams.get("lead_url"),
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
        resolve(null);
      },
      { timeout: 5000 }
    );
  });
}

export default function EmbedPage() {
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [embedStyle, setEmbedStyle] = useState<EmbedStyle>("card");
  const [enabledFields, setEnabledFields] = useState<Set<ProfileField>>(new Set());
  const [theme, setTheme] = useState<EmbedTheme>({
    accent: "#ff7a18",
    bg: "#1a0f0a",
    text: "#fff3e8",
    inputBg: "#2a1710",
  });
  const [company, setCompany] = useState("");
  const [browserGeo, setBrowserGeo] = useState<{ latitude: number; longitude: number } | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    document.body.classList.add("embed");
    const config = parseEmbedConfig();
    setEmbedStyle(config.style);
    setEnabledFields(config.enabledFields);
    setTheme(config.theme);

    requestBrowserGeolocation().then((geo) => {
      if (geo) {
        setBrowserGeo(geo);
      }
    });

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
          phone_number: phoneNumber,
          ...getClientContext(),
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
      ? "w-full border-0 border-b bg-transparent px-0 py-2 text-sm outline-none"
      : "w-full rounded-lg border px-4 py-3 text-sm outline-none transition";

  const profileInputClass =
    embedStyle === "minimal"
      ? "w-full border-0 border-b bg-transparent px-0 py-2 text-sm outline-none"
      : "w-full rounded-lg border px-3 py-2 text-sm outline-none transition";

  const buttonClass =
    embedStyle === "minimal"
      ? "rounded-md border px-4 py-2 text-sm font-bold transition disabled:opacity-60"
      : "rounded-lg px-6 py-3 text-sm font-bold transition active:scale-95 disabled:opacity-60 whitespace-nowrap";

  const panelStyle = {
    backgroundColor: theme.bg,
    color: theme.text,
    border: `1px solid ${theme.accent}55`,
    borderRadius: 12,
    padding: 14,
  } as const;

  const inputStyle = {
    backgroundColor: embedStyle === "minimal" ? "transparent" : theme.inputBg,
    color: theme.text,
    borderColor: `${theme.accent}99`,
  } as const;

  const minimalInputStyle = {
    borderColor: `${theme.accent}99`,
    color: theme.text,
  } as const;

  const buttonStyle =
    embedStyle === "minimal"
      ? { borderColor: theme.accent, color: theme.accent }
      : { backgroundColor: theme.accent, color: theme.bg };

  const helperTextStyle = { color: `${theme.text}bb` } as const;

  return (
    <div className="flex items-center justify-center bg-transparent p-4">
      <div className={wrapperClass} style={panelStyle}>
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
                style={embedStyle === "minimal" ? minimalInputStyle : inputStyle}
              />

              {enabledFields.size > 0 && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {hasField("first_name") && (
                    <input
                      id="embed-first-name"
                      name="first_name"
                      type="text"
                      autoComplete="given-name"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      placeholder="First name"
                      className={profileInputClass}
                      style={embedStyle === "minimal" ? minimalInputStyle : inputStyle}
                    />
                  )}
                  {hasField("last_name") && (
                    <input
                      id="embed-last-name"
                      name="last_name"
                      type="text"
                      autoComplete="family-name"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      placeholder="Last name"
                      className={profileInputClass}
                      style={embedStyle === "minimal" ? minimalInputStyle : inputStyle}
                    />
                  )}
                  {hasField("phone_number") && (
                    <input
                      id="embed-phone-number"
                      name="phone_number"
                      type="tel"
                      autoComplete="tel"
                      inputMode="tel"
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value)}
                      placeholder="Phone number"
                      className={profileInputClass}
                      style={embedStyle === "minimal" ? minimalInputStyle : inputStyle}
                    />
                  )}
                  {hasField("date_of_birth") && (
                    <label className="block text-[11px]" style={helperTextStyle}>
                      <span className="mb-1 block" id="embed-birthday-label">Birthday</span>
                      <input
                        id="embed-birthday"
                        name="birthday"
                        type="text"
                        autoComplete="bday"
                        aria-labelledby="embed-birthday-label"
                        value={dateOfBirth}
                        onChange={(e) => setDateOfBirth(e.target.value)}
                        inputMode="numeric"
                        placeholder="MM/DD/YYYY"
                        className={profileInputClass}
                        style={embedStyle === "minimal" ? minimalInputStyle : inputStyle}
                      />
                      <span className="mt-1 block">Optional. Share your birthday for birthday campaigns and offers.</span>
                    </label>
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
              style={buttonStyle}
            >
              {status === "loading" ? "Joining..." : "Join the list"}
            </button>
          </form>
        ) : (
          <div className="rounded-lg px-6 py-4" style={{ border: `1px solid ${theme.accent}66`, backgroundColor: theme.inputBg }}>
            <p className="text-sm font-medium" style={{ color: theme.text }}>
              You&apos;re in. Check your inbox to confirm.
            </p>
            <p className="mt-1 text-xs" style={helperTextStyle}>{message || "Welcome to the system."}</p>
          </div>
        )}

        {status === "error" && (
          <p className="mt-2 text-xs" style={{ color: theme.text }}>{message}</p>
        )}

        <p className="mt-3 text-xs" style={helperTextStyle}>
          No spam. No sharing. Unsubscribe any time.
        </p>
      </div>
    </div>
  );
}
