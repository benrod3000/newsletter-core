"use client";

import { useEffect, useState } from "react";

interface DashboardNavProps {
  role: string | null;
  totalCount: number;
  confirmedCount: number;
  confirmationRate: number;
}

export default function DashboardNav({
  role,
  totalCount,
  confirmedCount,
  confirmationRate,
}: DashboardNavProps) {
  const [activeSection, setActiveSection] = useState<string>("campaigns");
  const [showNav, setShowNav] = useState(false);
  const [showStats, setShowStats] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      const sections = ["campaigns", "workspaces", "subscribers"].filter(
        (section) => {
          if (section === "workspaces" && role !== "owner") return false;
          return true;
        }
      );

      let current = sections[0];
      for (const section of sections) {
        const element = document.getElementById(section);
        if (element) {
          const rect = element.getBoundingClientRect();
          if (rect.top <= 120) {
            current = section;
          }
        }
      }
      setActiveSection(current);
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, [role]);

  const links = [
    { id: "campaigns", label: "Campaigns" },
    ...(role === "owner" ? [{ id: "workspaces", label: "Workspaces" }] : []),
    { id: "subscribers", label: "Subscribers" },
  ];

  return (
    <div className="fixed inset-x-0 top-0 z-40 border-b border-zinc-800 bg-zinc-950/95 px-4 py-3 sm:px-6 backdrop-blur-sm">
      <div className="mx-auto w-full max-w-none">
        <div className="flex items-center justify-between gap-3">
          {/* Nav Toggle (mobile only) */}
          <button
            onClick={() => setShowNav(!showNav)}
            className={`flex-shrink-0 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors sm:hidden ${
              showNav
                ? "border-amber-500 bg-amber-500/20 text-amber-300"
                : "border-zinc-700 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
            }`}
          >
            Jump {showNav ? "−" : "+"}
          </button>

          {/* Navigation Links (desktop always visible) */}
          <div className={`hidden sm:flex items-center gap-2 overflow-x-auto ${showNav ? 'flex' : ''}`}>
            {links.map((link) => (
              <a
                key={link.id}
                href={`#${link.id}`}
                className={`whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors sm:text-sm ${
                  activeSection === link.id
                    ? "border border-amber-500 bg-amber-500/20 text-amber-300"
                    : "border border-zinc-700 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
                }`}
              >
                {link.label}
              </a>
            ))}
          </div>

          {/* Stats Toggle */}
          <button
            onClick={() => setShowStats(!showStats)}
            className={`ml-auto flex-shrink-0 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors sm:px-3 ${
              showStats
                ? "border-amber-500 bg-amber-500/20 text-amber-300"
                : "border-zinc-700 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
            }`}
          >
            Stats {showStats ? "−" : "+"}
          </button>
        </div>

        {/* Mobile Navigation Bar */}
        {showNav && (
          <div className="mt-3 flex flex-col gap-2 sm:hidden">
            {links.map((link) => (
              <a
                key={link.id}
                href={`#${link.id}`}
                onClick={() => setShowNav(false)}
                className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  activeSection === link.id
                    ? "border border-amber-500 bg-amber-500/20 text-amber-300"
                    : "border border-zinc-700 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
                }`}
              >
                {link.label}
              </a>
            ))}
          </div>
        )}

        {/* Stats Bar */}
        {showStats && (
          <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
            <div className="rounded-md border border-zinc-800 bg-zinc-900/50 px-2 py-1.5">
              <p className="text-xs uppercase tracking-wider text-zinc-500">Total</p>
              <p className="mt-0.5 text-sm font-semibold text-white sm:text-base">
                {totalCount}
              </p>
            </div>
            <div className="rounded-md border border-emerald-900/50 bg-emerald-950/30 px-2 py-1.5">
              <p className="text-xs uppercase tracking-wider text-emerald-500">Confirmed</p>
              <p className="mt-0.5 text-sm font-semibold text-emerald-300 sm:text-base">
                {confirmedCount}
              </p>
            </div>
            <div className="rounded-md border border-zinc-800 bg-zinc-900/50 px-2 py-1.5">
              <p className="text-xs uppercase tracking-wider text-zinc-500">Rate</p>
              <p className="mt-0.5 text-sm font-semibold text-amber-300 sm:text-base">
                {confirmationRate}%
              </p>
            </div>
            <div className="hidden rounded-md border border-zinc-800 bg-zinc-900/50 px-2 py-1.5 sm:block">
              <p className="text-xs uppercase tracking-wider text-zinc-500">Pending</p>
              <p className="mt-0.5 text-sm font-semibold text-zinc-300">
                {totalCount - confirmedCount}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
