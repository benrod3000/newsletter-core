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

  useEffect(() => {
    const handleScroll = () => {
      const sections = ["campaigns", "workspaces", "subscribers", "lists", "import", "embed"].filter(
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
    { id: "campaigns", label: "Campaigns", icon: "✉️" },
    { id: "subscribers", label: "Subscribers", icon: "👥" },
    { id: "lists", label: "Lists", icon: "📋" },
    { id: "import", label: "Import", icon: "📥" },
    { id: "embed", label: "Embed", icon: "📦" },
    ...(role === "owner" ? [{ id: "workspaces", label: "Workspaces", icon: "🏢" }] : []),
  ];

  const pendingCount = totalCount - confirmedCount;

  return (
    <div className="fixed inset-x-0 top-0 z-50 border-b border-zinc-700 bg-gradient-to-b from-[#0d0d0d]/95 to-[#1a1a1a]/95 px-3 py-3 sm:px-6 backdrop-blur-lg">
      <div className="mx-auto w-full max-w-7xl">
        <div className="space-y-3">
          {/* Top Row: Branding & Stats */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-amber-400 to-amber-600">
                <span className="text-sm font-bold text-black">📬</span>
              </div>
              <div className="hidden sm:block">
                <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Newsletter</p>
                <p className="font-semibold text-zinc-100">Elite Hub</p>
              </div>
            </div>

            {/* Quick Stats */}
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/60 px-2 py-1 sm:px-3 sm:py-1.5">
                <span className="text-xs sm:text-sm font-medium text-zinc-400">👥</span>
                <span className="text-xs sm:text-sm font-semibold text-zinc-100">{totalCount}</span>
              </div>
              <div className="flex items-center gap-1.5 rounded-lg border border-emerald-900/40 bg-emerald-950/30 px-2 py-1 sm:px-3 sm:py-1.5">
                <span className="text-xs sm:text-sm font-medium text-emerald-400">✓</span>
                <span className="text-xs sm:text-sm font-semibold text-emerald-300">{confirmationRate}%</span>
              </div>
              <button
                onClick={() => setShowNav(!showNav)}
                className={`flex-shrink-0 rounded-lg border px-2 py-1 text-xs font-medium transition-all sm:hidden ${
                  showNav
                    ? "border-amber-500 bg-amber-500/20 text-amber-300"
                    : "border-zinc-700 text-zinc-400 hover:border-zinc-600"
                }`}
              >
                {showNav ? "Hide" : "Menu"}
              </button>
            </div>
          </div>

          {/* Navigation Links */}
          <div className={`transition-all duration-200 ${showNav ? "block sm:flex" : "hidden sm:flex"}`}>
            <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-1 w-full sm:w-auto">
              {links.map((link) => (
                <a
                  key={link.id}
                  href={`#${link.id}`}
                  onClick={() => setShowNav(false)}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-all sm:text-sm whitespace-nowrap ${
                    activeSection === link.id
                      ? "border border-amber-500 bg-amber-500/15 text-amber-300 shadow-lg shadow-amber-500/10"
                      : "border border-zinc-700 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200 hover:bg-zinc-900/40"
                  }`}
                >
                  <span className="text-sm">{link.icon}</span>
                  <span>{link.label}</span>
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
