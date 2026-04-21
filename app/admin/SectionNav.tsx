"use client";

import { useEffect, useState } from "react";

interface SectionNavProps {
  role: string | null;
  onMobile?: boolean;
}

export default function SectionNav({ role, onMobile = false }: SectionNavProps) {
  const [activeSection, setActiveSection] = useState<string>("campaigns");

  useEffect(() => {
    const handleScroll = () => {
      // Get all section elements
      const sections = ["campaigns", "workspaces", "subscribers"].filter(
        (section) => {
          if (section === "workspaces" && role !== "owner") return false;
          return true;
        }
      );

      // Find which section is currently in view
      let current = sections[0];
      for (const section of sections) {
        const element = document.getElementById(section);
        if (element) {
          const rect = element.getBoundingClientRect();
          // If section top is within viewport (considering offset)
          if (rect.top <= 200) {
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

  const containerClasses = onMobile
    ? "flex flex-wrap gap-2 text-sm"
    : "flex flex-col gap-2 text-sm";

  return (
    <div className={containerClasses}>
      {links.map((link) => (
        <a
          key={link.id}
          href={`#${link.id}`}
          className={`rounded-md px-3 py-2 transition-colors ${
            activeSection === link.id
              ? "border border-amber-500 bg-amber-500/20 text-amber-300"
              : "border border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white"
          }`}
        >
          {link.label}
        </a>
      ))}
    </div>
  );
}
