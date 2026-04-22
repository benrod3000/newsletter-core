"use client";

import { useMemo, useState } from "react";

type EmbedStyle = "card" | "bar" | "minimal";

function buildQuery(clientSlug: string, style: EmbedStyle, includeProfileFields: boolean) {
  const params = new URLSearchParams();
  if (clientSlug.trim()) params.set("client", clientSlug.trim());
  params.set("style", style);
  if (includeProfileFields) {
    params.set("fields", "first_name,last_name,date_of_birth,job_title");
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

function iframeCode(origin: string, query: string, title: string, height: number) {
  const src = `${origin}/embed${query}`;
  return `<iframe\n  src="${src}"\n  title="${title}"\n  width="100%"\n  height="${height}"\n  frameborder="0"\n  style="border:0;max-width:640px;"\n></iframe>`;
}

function scriptCode(origin: string, query: string, height: number) {
  const src = `${origin}/embed${query}`;
  return `<div id="newsletter-signup"></div>\n<script>\n  (function () {\n    var el = document.getElementById("newsletter-signup");\n    if (!el) return;\n    var iframe = document.createElement("iframe");\n    iframe.src = "${src}";\n    iframe.width = "100%";\n    iframe.height = "${height}";\n    iframe.style.border = "0";\n    iframe.style.maxWidth = "640px";\n    iframe.setAttribute("title", "Newsletter signup");\n    el.appendChild(iframe);\n  })();\n</script>`;
}

export default function EmbedCodePanel() {
  const [origin, setOrigin] = useState("");
  const [clientSlug, setClientSlug] = useState("default");
  const [style, setStyle] = useState<EmbedStyle>("card");
  const [includeProfileFields, setIncludeProfileFields] = useState(false);
  const [copied, setCopied] = useState("");

  const resolvedOrigin = useMemo(() => {
    if (typeof window === "undefined") return origin || "https://your-domain.com";
    return origin || window.location.origin;
  }, [origin]);

  const query = useMemo(
    () => buildQuery(clientSlug, style, includeProfileFields),
    [clientSlug, style, includeProfileFields]
  );

  const embedUrl = `${resolvedOrigin}/embed${query}`;
  const iframeHeight = includeProfileFields ? 330 : 170;
  const iframeSnippet = iframeCode(resolvedOrigin, query, "Newsletter signup", iframeHeight);
  const scriptSnippet = scriptCode(resolvedOrigin, query, iframeHeight);

  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(`${label} copied`);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      setCopied("Copy failed");
      setTimeout(() => setCopied(""), 1500);
    }
  }

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-4 sm:p-5">
      <p className="text-xs font-semibold uppercase tracking-widest text-amber-400">Embed</p>
      <h2 className="mt-1 text-base font-semibold text-white">Embed signup form</h2>
      <p className="mt-1 text-xs text-zinc-500">
        Generate copy/paste embed code for client websites with multiple style options.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-zinc-500">Domain</label>
          <input
            type="text"
            value={origin}
            onChange={(e) => setOrigin(e.target.value.trim())}
            placeholder="https://your-domain.com"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-amber-400"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-zinc-500">Client slug</label>
          <input
            type="text"
            value={clientSlug}
            onChange={(e) => setClientSlug(e.target.value)}
            placeholder="default"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-amber-400"
          />
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-zinc-500">Embed style</label>
          <select
            value={style}
            onChange={(e) => setStyle(e.target.value as EmbedStyle)}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-amber-400"
          >
            <option value="card">Card form</option>
            <option value="bar">Inline bar</option>
            <option value="minimal">Minimal line</option>
          </select>
        </div>
        <label className="flex items-center gap-2 self-end text-sm text-zinc-300">
          <input
            type="checkbox"
            checked={includeProfileFields}
            onChange={(e) => setIncludeProfileFields(e.target.checked)}
            className="rounded border-zinc-600 bg-zinc-800 text-amber-400 focus:ring-amber-400"
          />
          Include optional profile fields
        </label>
      </div>

      <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3 text-xs text-zinc-400">
        <p className="text-zinc-300">Embed URL</p>
        <p className="mt-1 break-all">{embedUrl}</p>
      </div>

      <div className="mt-4 space-y-3">
        <div>
          <div className="mb-1 flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">Iframe snippet</p>
            <button
              type="button"
              onClick={() => copy("Iframe", iframeSnippet)}
              className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-zinc-500"
            >
              Copy
            </button>
          </div>
          <pre className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 text-[11px] text-zinc-300">{iframeSnippet}</pre>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">Script snippet</p>
            <button
              type="button"
              onClick={() => copy("Script", scriptSnippet)}
              className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-zinc-500"
            >
              Copy
            </button>
          </div>
          <pre className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 text-[11px] text-zinc-300">{scriptSnippet}</pre>
        </div>

        {copied && <p className="text-xs text-emerald-400">{copied}</p>}
      </div>
    </section>
  );
}
