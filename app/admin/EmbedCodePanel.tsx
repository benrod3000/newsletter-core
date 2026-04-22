"use client";

import { useMemo, useState } from "react";

type EmbedStyle = "card" | "bar" | "minimal";
type ThemePreset = {
  name: string;
  accent: string;
  bg: string;
  text: string;
  inputBg: string;
};

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const normalized = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return null;
  const value = Number.parseInt(normalized, 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function relativeLuminance(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function contrastRatio(a: string, b: string): number {
  const rgbA = hexToRgb(a);
  const rgbB = hexToRgb(b);
  if (!rgbA || !rgbB) return 21;

  const lumA =
    0.2126 * relativeLuminance(rgbA.r) +
    0.7152 * relativeLuminance(rgbA.g) +
    0.0722 * relativeLuminance(rgbA.b);
  const lumB =
    0.2126 * relativeLuminance(rgbB.r) +
    0.7152 * relativeLuminance(rgbB.g) +
    0.0722 * relativeLuminance(rgbB.b);

  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b]
    .map((channel) => Math.max(0, Math.min(255, channel)).toString(16).padStart(2, "0"))
    .join("")}`;
}

function colorDistance(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return dr * dr + dg * dg + db * db;
}

function findNearestAccessibleTextColor(text: string, bg: string, inputBg: string): string | null {
  const textRgb = hexToRgb(text);
  if (!textRgb) return null;

  let bestHex: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let i = 0; i <= 255; i++) {
    const candidate = rgbToHex(i, i, i);
    const bgContrast = contrastRatio(candidate, bg);
    const inputContrast = contrastRatio(candidate, inputBg);
    if (bgContrast < 4.5 || inputContrast < 4.5) continue;

    const distance = colorDistance(textRgb, { r: i, g: i, b: i });
    if (distance < bestDistance) {
      bestDistance = distance;
      bestHex = candidate;
    }
  }

  return bestHex;
}

function findNearestAccessibleAccentColor(accent: string, bg: string): string | null {
  const accentRgb = hexToRgb(accent);
  if (!accentRgb) return null;

  const candidates = [
    "#ffffff",
    "#fbbf24",
    "#f97316",
    "#22c55e",
    "#0ea5e9",
    "#e11d48",
    "#a855f7",
    "#000000",
  ];

  let bestHex: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    if (contrastRatio(candidate, bg) < 3) continue;
    const rgb = hexToRgb(candidate);
    if (!rgb) continue;
    const distance = colorDistance(accentRgb, rgb);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestHex = candidate;
    }
  }

  return bestHex;
}

const THEME_PRESETS: ThemePreset[] = [
  { name: "Sunset", accent: "#ff7a18", bg: "#1a0f0a", text: "#fff3e8", inputBg: "#2a1710" },
  { name: "Ocean", accent: "#0ea5e9", bg: "#081825", text: "#e0f2fe", inputBg: "#102335" },
  { name: "Forest", accent: "#22c55e", bg: "#0a1a12", text: "#e8fff3", inputBg: "#153024" },
  { name: "Charcoal", accent: "#f59e0b", bg: "#111111", text: "#f4f4f5", inputBg: "#202022" },
];

function buildQuery(
  clientSlug: string,
  style: EmbedStyle,
  includeProfileFields: boolean,
  colors: { accent: string; bg: string; text: string; inputBg: string },
  leadMagnet: { title: string; url: string }
) {
  const params = new URLSearchParams();
  if (clientSlug.trim()) params.set("client", clientSlug.trim());
  params.set("style", style);
  params.set("accent", colors.accent);
  params.set("bg", colors.bg);
  params.set("text", colors.text);
  params.set("input_bg", colors.inputBg);
  if (leadMagnet.title.trim()) params.set("lead_title", leadMagnet.title.trim());
  if (leadMagnet.url.trim()) params.set("lead_url", leadMagnet.url.trim());
  if (includeProfileFields) {
    params.set("fields", "first_name,last_name,date_of_birth,phone_number");
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
  const [accent, setAccent] = useState(THEME_PRESETS[0].accent);
  const [bg, setBg] = useState(THEME_PRESETS[0].bg);
  const [text, setText] = useState(THEME_PRESETS[0].text);
  const [inputBg, setInputBg] = useState(THEME_PRESETS[0].inputBg);
  const [leadTitle, setLeadTitle] = useState("Free Track Download");
  const [leadUrl, setLeadUrl] = useState("");
  const [copied, setCopied] = useState("");
  const [showSnippets, setShowSnippets] = useState(false);

  const resolvedOrigin = useMemo(() => {
    if (typeof window === "undefined") return origin || "https://your-domain.com";
    return origin || window.location.origin;
  }, [origin]);

  const query = useMemo(
    () => buildQuery(clientSlug, style, includeProfileFields, { accent, bg, text, inputBg }, { title: leadTitle, url: leadUrl }),
    [clientSlug, style, includeProfileFields, accent, bg, text, inputBg, leadTitle, leadUrl]
  );

  const embedUrl = `${resolvedOrigin}/embed${query}`;
  const iframeHeight = includeProfileFields ? 470 : 300;
  const iframeSnippet = iframeCode(resolvedOrigin, query, "Newsletter signup", iframeHeight);
  const scriptSnippet = scriptCode(resolvedOrigin, query, iframeHeight);
  const bgTextContrast = contrastRatio(text, bg);
  const inputTextContrast = contrastRatio(text, inputBg);
  const accentBgContrast = contrastRatio(accent, bg);
  const hasContrastWarning = bgTextContrast < 4.5 || inputTextContrast < 4.5;
  const suggestedTextColor = useMemo(() => {
    if (!hasContrastWarning) return null;
    return findNearestAccessibleTextColor(text, bg, inputBg);
  }, [hasContrastWarning, text, bg, inputBg]);
  const suggestedAccentColor = useMemo(() => {
    if (accentBgContrast >= 3) return null;
    return findNearestAccessibleAccentColor(accent, bg);
  }, [accentBgContrast, accent, bg]);

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

  function applyPreset(preset: ThemePreset) {
    setAccent(preset.accent);
    setBg(preset.bg);
    setText(preset.text);
    setInputBg(preset.inputBg);
  }

  function autoFixContrast() {
    if (suggestedTextColor) setText(suggestedTextColor);
    if (suggestedAccentColor) setAccent(suggestedAccentColor);
  }

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-4 sm:p-5">
      <p className="text-xs font-semibold uppercase tracking-widest text-amber-400">Embed</p>
      <h2 className="mt-1 text-base font-semibold text-white">Embed signup form</h2>
      <p className="mt-1 text-xs text-zinc-500">
        Generate embed code with style presets, color controls, and a live preview.
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

      <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
        <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">Media campaign offer (optional)</p>
        <p className="mt-1 text-xs text-zinc-500">
          Use this for lead magnets like a free song, sample pack, or media kit link delivered after confirmation.
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          The download button routes through our tracker first so we can refresh subscriber geolocation and log the claim, then we forward to your file URL with city, region, country, timezone, locale, UTM source, landing path, and referrer attached.
        </p>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <input
            type="text"
            value={leadTitle}
            onChange={(e) => setLeadTitle(e.target.value)}
            placeholder="Free Track Download"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-amber-400"
          />
          <input
            type="url"
            value={leadUrl}
            onChange={(e) => setLeadUrl(e.target.value)}
            placeholder="https://yourcdn.com/free-song.mp3"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-amber-400"
          />
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
        <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">Theme presets</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {THEME_PRESETS.map((preset) => (
            <button
              key={preset.name}
              type="button"
              onClick={() => applyPreset(preset)}
              className="rounded border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:border-zinc-500"
            >
              {preset.name}
            </button>
          ))}
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs text-zinc-400">
            Accent
            <input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} className="mt-1 h-9 w-full rounded border border-zinc-700 bg-zinc-900 p-1" />
          </label>
          <label className="text-xs text-zinc-400">
            Background
            <input type="color" value={bg} onChange={(e) => setBg(e.target.value)} className="mt-1 h-9 w-full rounded border border-zinc-700 bg-zinc-900 p-1" />
          </label>
          <label className="text-xs text-zinc-400">
            Text
            <input type="color" value={text} onChange={(e) => setText(e.target.value)} className="mt-1 h-9 w-full rounded border border-zinc-700 bg-zinc-900 p-1" />
          </label>
          <label className="text-xs text-zinc-400">
            Input bg
            <input type="color" value={inputBg} onChange={(e) => setInputBg(e.target.value)} className="mt-1 h-9 w-full rounded border border-zinc-700 bg-zinc-900 p-1" />
          </label>
        </div>

        <p className="mt-2 text-xs text-zinc-500">
          Contrast: text/background {bgTextContrast.toFixed(1)}:1, text/input {inputTextContrast.toFixed(1)}:1, accent/background {accentBgContrast.toFixed(1)}:1
        </p>

        {hasContrastWarning && (
          <div className="mt-2 rounded border border-amber-700/60 bg-amber-950/30 px-2 py-2 text-xs text-amber-200">
            <p>Low contrast detected. Some users may struggle to read this embed. Aim for at least 4.5:1.</p>
            {suggestedTextColor && suggestedTextColor.toLowerCase() !== text.toLowerCase() && (
              <div className="mt-2 flex items-center gap-2">
                <span>Suggested text color: {suggestedTextColor}</span>
                <button
                  type="button"
                  onClick={() => setText(suggestedTextColor)}
                  className="rounded border border-amber-500/70 px-2 py-1 text-[11px] text-amber-100 hover:bg-amber-500/20"
                >
                  Apply suggestion
                </button>
              </div>
            )}
            {(suggestedTextColor || suggestedAccentColor) && (
              <button
                type="button"
                onClick={autoFixContrast}
                className="mt-2 rounded border border-amber-400 px-2 py-1 text-[11px] font-semibold text-amber-100 hover:bg-amber-500/20"
              >
                Auto-fix all contrast
              </button>
            )}
          </div>
        )}
      </div>

      <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">Live preview</p>
          <a href={embedUrl} target="_blank" rel="noreferrer" className="text-xs text-amber-300 hover:text-amber-200">
            Open standalone preview
          </a>
        </div>
        <div className="rounded border border-zinc-800 bg-zinc-900/30 p-2">
          <iframe
            key={embedUrl}
            src={embedUrl}
            title="Embed preview"
            width="100%"
            height={iframeHeight}
            style={{ border: 0, borderRadius: 8 }}
          />
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
        <button
          type="button"
          onClick={() => setShowSnippets((current) => !current)}
          className="w-full rounded border border-zinc-700 px-3 py-2 text-left text-xs font-medium text-zinc-300 hover:border-zinc-500"
        >
          {showSnippets ? "Hide embed code snippets" : "Show embed code snippets"}
        </button>

        {showSnippets && (
          <div className="mt-3 space-y-3 text-xs text-zinc-400">
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-zinc-300">Embed URL</p>
                <button
                  type="button"
                  onClick={() => copy("Embed URL", embedUrl)}
                  className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-zinc-500"
                >
                  Copy URL
                </button>
              </div>
              <p className="mt-1 break-all">{embedUrl}</p>
            </div>

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
        )}
      </div>
    </section>
  );
}
