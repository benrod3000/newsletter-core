"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "grapesjs";

type Audience = "confirmed" | "all" | "pending";

type SendStatus = "idle" | "sending" | "success" | "error";

type Role = "owner" | "editor" | "viewer";

interface Campaign {
  id: string;
  client_id: string;
  title: string;
  subject: string;
  audience: Audience;
  status: "draft" | "scheduled" | "sent";
  editor_html: string;
  editor_css: string | null;
  plain_text: string | null;
  scheduled_for: string | null;
  sent_count: number;
  last_sent_at: string | null;
  last_test_sent_at: string | null;
  last_test_recipient: string | null;
  geo_filter: {
    country?: string | null;
    region?: string | null;
    city?: string | null;
    center_lat?: number | null;
    center_lng?: number | null;
    radius_km?: number | null;
  } | null;
  updated_at: string;
}

interface ClientWorkspace {
  id: string;
  name: string;
  slug: string;
}

interface CampaignApiResponse {
  campaigns: Campaign[];
  clients: ClientWorkspace[];
  admin: {
    username: string;
    role: Role;
    clientId: string | null;
  };
}

interface AdminMailerProps {
  totalCount: number;
  confirmedCount: number;
  subscribers: Array<{
    country: string | null;
    region: string | null;
    city: string | null;
  }>;
}

function uniqueGeo(values: Array<string | null>) {
  return Array.from(new Set(values.filter((v): v is string => Boolean(v)))).sort();
}

const DEFAULT_COMPONENTS = `
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#0d0d0d;padding:24px 0;">
    <tr>
      <td align="center">
        <table width="640" cellpadding="0" cellspacing="0" role="presentation" style="max-width:640px;background:#18181b;border:1px solid #27272a;border-radius:12px;overflow:hidden;">
          <tr>
            <td style="padding:20px 28px;border-bottom:1px solid #27272a;">
              <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#fbbf24;">
                Newsletter Services
              </p>
              <h1 style="margin:12px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:28px;line-height:1.2;color:#fff;">
                Weekly Brief
              </h1>
            </td>
          </tr>
          <tr>
            <td style="padding:28px;font-family:Arial,Helvetica,sans-serif;color:#e4e4e7;font-size:15px;line-height:1.7;">
              <p style="margin:0 0 16px;">Write your newsletter content here.</p>
              <p style="margin:0 0 16px;">Use the blocks panel to add sections, images, buttons, and columns.</p>
              <p style="margin:0;">- Your team</p>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 28px;border-top:1px solid #27272a;font-family:Arial,Helvetica,sans-serif;color:#71717a;font-size:12px;line-height:1.5;">
              You are receiving this email because you subscribed to the newsletter.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
`;

const DEFAULT_STYLE = `
  body { margin: 0; }
  * { box-sizing: border-box; }
`;

function htmlToText(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toLocalInputValue(iso: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function audienceLabel(audience: Audience, totalCount: number, confirmedCount: number) {
  if (audience === "all") return `all subscribers (${totalCount})`;
  if (audience === "pending") return `pending subscribers (${Math.max(totalCount - confirmedCount, 0)})`;
  return `confirmed subscribers (${confirmedCount})`;
}

export default function AdminMailer({ totalCount, confirmedCount, subscribers }: AdminMailerProps) {
  const [audience, setAudience] = useState<Audience>("confirmed");
  const [title, setTitle] = useState("Untitled Draft");
  const [subject, setSubject] = useState("");
  const [scheduledFor, setScheduledFor] = useState("");
  const [testEmail, setTestEmail] = useState("");
  const [geoCountry, setGeoCountry] = useState("");
  const [geoRegion, setGeoRegion] = useState("");
  const [geoCity, setGeoCity] = useState("");
  const [geoRadiusKm, setGeoRadiusKm] = useState("");
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [clients, setClients] = useState<ClientWorkspace[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>("");
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [role, setRole] = useState<Role>("owner");
  const [username, setUsername] = useState("");
  const [loadingCampaigns, setLoadingCampaigns] = useState(true);
  const [status, setStatus] = useState<SendStatus>("idle");
  const [feedback, setFeedback] = useState("");
  const [editorReady, setEditorReady] = useState(false);
  const editorContainerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<Editor | null>(null);

  useEffect(() => {
    let mounted = true;

    async function initEditor() {
      if (!editorContainerRef.current || editorRef.current) return;

      const grapesjs = (await import("grapesjs")).default;
      const presetNewsletter = (await import("grapesjs-preset-newsletter")).default;

      const editor = grapesjs.init({
        container: editorContainerRef.current,
        height: "560px",
        storageManager: false,
        fromElement: false,
        components: DEFAULT_COMPONENTS,
        style: DEFAULT_STYLE,
        plugins: [presetNewsletter],
      });

      editorRef.current = editor;
      if (mounted) setEditorReady(true);
    }

    initEditor();

    return () => {
      mounted = false;
      if (editorRef.current) {
        editorRef.current.destroy();
        editorRef.current = null;
      }
    };
  }, []);

  const targetLabel = useMemo(
    () => audienceLabel(audience, totalCount, confirmedCount),
    [audience, totalCount, confirmedCount]
  );

  const countryOptions = useMemo(() => uniqueGeo(subscribers.map((s) => s.country)), [subscribers]);
  const regionOptions = useMemo(() => uniqueGeo(subscribers.map((s) => s.region)), [subscribers]);
  const cityOptions = useMemo(() => uniqueGeo(subscribers.map((s) => s.city)), [subscribers]);

  const geoSummary = useMemo(() => {
    const parts = [geoCity, geoRegion, geoCountry].filter(Boolean);
    const location = parts.length ? parts.join(", ") : "all locations";
    return geoRadiusKm ? `${location} within ${geoRadiusKm} km` : location;
  }, [geoCity, geoRegion, geoCountry, geoRadiusKm]);

  const canEdit = role === "owner" || role === "editor";

  async function refreshCampaigns() {
    setLoadingCampaigns(true);
    try {
      const res = await fetch("/api/admin/campaigns", { method: "GET" });
      const data = (await res.json()) as CampaignApiResponse & { error?: string };
      if (!res.ok) {
        setStatus("error");
        setFeedback(data.error ?? "Could not load campaigns.");
        return;
      }

      setCampaigns(data.campaigns ?? []);
      setClients(data.clients ?? []);
      setRole(data.admin?.role ?? "owner");
      setUsername(data.admin?.username ?? "");

      if (data.admin?.clientId) {
        setSelectedClientId(data.admin.clientId);
      } else if (!selectedClientId && data.clients?.length) {
        setSelectedClientId(data.clients[0].id);
      }
    } catch {
      setStatus("error");
      setFeedback("Network error while loading campaigns.");
    } finally {
      setLoadingCampaigns(false);
    }
  }

  useEffect(() => {
    refreshCampaigns();
  }, []);

  function loadCampaign(campaign: Campaign) {
    const editor = editorRef.current;
    setSelectedCampaignId(campaign.id);
    setTitle(campaign.title || "Untitled Draft");
    setSubject(campaign.subject || "");
    setAudience(campaign.audience || "confirmed");
    setGeoCountry(campaign.geo_filter?.country || "");
    setGeoRegion(campaign.geo_filter?.region || "");
    setGeoCity(campaign.geo_filter?.city || "");
    setGeoRadiusKm(
      typeof campaign.geo_filter?.radius_km === "number" ? String(campaign.geo_filter.radius_km) : ""
    );
    setScheduledFor(toLocalInputValue(campaign.scheduled_for));
    setSelectedClientId(campaign.client_id || selectedClientId);

    if (editor) {
      editor.setComponents(campaign.editor_html || DEFAULT_COMPONENTS);
      editor.setStyle(campaign.editor_css || DEFAULT_STYLE);
    }
  }

  function resetComposer() {
    const editor = editorRef.current;
    setSelectedCampaignId("");
    setTitle("Untitled Draft");
    setSubject("");
    setAudience("confirmed");
    setGeoCountry("");
    setGeoRegion("");
    setGeoCity("");
    setGeoRadiusKm("");
    setScheduledFor("");
    if (editor) {
      editor.setComponents(DEFAULT_COMPONENTS);
      editor.setStyle(DEFAULT_STYLE);
    }
  }

  function getContent() {
    const editor = editorRef.current;
    if (!editor) return null;
    const html = editor.getHtml();
    const css = editor.getCss();
    const text = htmlToText(html);
    return { html, css, text };
  }

  async function saveCampaign(nextStatus: "draft" | "scheduled") {
    if (!canEdit) return;
    const content = getContent();
    if (!content) {
      setStatus("error");
      setFeedback("Editor is still loading. Please try again in a moment.");
      return;
    }

    if (!subject.trim() || !content.text) {
      setStatus("error");
      setFeedback("Subject and content are required.");
      return;
    }

    if (nextStatus === "scheduled" && !scheduledFor) {
      setStatus("error");
      setFeedback("Pick a schedule date/time before scheduling.");
      return;
    }

    setStatus("sending");
    setFeedback("");

    try {
      const res = await fetch("/api/admin/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: selectedCampaignId || undefined,
          clientId: selectedClientId || undefined,
          title: title.trim() || "Untitled Draft",
          subject: subject.trim(),
          audience,
          geoFilter: {
            country: geoCountry || null,
            region: geoRegion || null,
            city: geoCity || null,
            radius_km: geoRadiusKm ? Number.parseFloat(geoRadiusKm) : null,
          },
          status: nextStatus,
          scheduledFor: nextStatus === "scheduled" ? new Date(scheduledFor).toISOString() : null,
          editorHtml: content.html,
          editorCss: content.css,
          plainText: content.text,
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setStatus("error");
        setFeedback(data?.error ?? "Failed to save campaign.");
        return;
      }

      setStatus("success");
      setFeedback(nextStatus === "scheduled" ? "Campaign scheduled." : "Draft saved.");
      const campaignId = data?.campaign?.id;
      if (campaignId) setSelectedCampaignId(campaignId);
      await refreshCampaigns();
    } catch {
      setStatus("error");
      setFeedback("Network error while saving campaign.");
    }
  }

  async function sendTestEmail() {
    if (!canEdit) return;
    const content = getContent();
    if (!content) {
      setStatus("error");
      setFeedback("Editor is still loading. Please try again in a moment.");
      return;
    }

    if (!testEmail.trim()) {
      setStatus("error");
      setFeedback("Enter a test email address.");
      return;
    }

    setStatus("sending");
    setFeedback("");

    try {
      const res = await fetch("/api/admin/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId: selectedCampaignId || undefined,
          audience,
          geoFilter: {
            country: geoCountry || null,
            region: geoRegion || null,
            city: geoCity || null,
            radius_km: geoRadiusKm ? Number.parseFloat(geoRadiusKm) : null,
          },
          subject: subject.trim(),
          message: content.text,
          html: content.html,
          css: content.css,
          testEmail: testEmail.trim(),
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setStatus("error");
        setFeedback(data?.error ?? "Failed to send test email.");
        return;
      }

      setStatus("success");
      setFeedback(`Test email sent to ${testEmail.trim()}.`);
      await refreshCampaigns();
    } catch {
      setStatus("error");
      setFeedback("Network error while sending test email.");
    }
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();

    if (!canEdit) {
      setStatus("error");
      setFeedback("Your role can view campaigns but cannot send them.");
      return;
    }

    const content = getContent();
    if (!content) {
      setStatus("error");
      setFeedback("Editor is still loading. Please try again in a moment.");
      return;
    }

    if (!subject.trim() || !content.text) {
      setStatus("error");
      setFeedback("Subject and message are required.");
      return;
    }

    setStatus("sending");
    setFeedback("");

    try {
      const res = await fetch("/api/admin/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId: selectedCampaignId || undefined,
          audience,
          geoFilter: {
            country: geoCountry || null,
            region: geoRegion || null,
            city: geoCity || null,
            radius_km: geoRadiusKm ? Number.parseFloat(geoRadiusKm) : null,
          },
          subject: subject.trim(),
          message: content.text,
          html: content.html,
          css: content.css,
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setStatus("error");
        setFeedback(data?.error ?? "Failed to send campaign.");
        return;
      }

      setStatus("success");
      setFeedback(`Email sent to ${data?.sentCount ?? 0} subscribers.`);
      await refreshCampaigns();
    } catch {
      setStatus("error");
      setFeedback("Network error while sending email.");
    }
  }

  async function runScheduledNow() {
    if (!canEdit) return;
    setStatus("sending");
    setFeedback("");

    try {
      const res = await fetch("/api/admin/campaigns/process", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setStatus("error");
        setFeedback(data?.error ?? "Failed to process scheduled campaigns.");
        return;
      }

      setStatus("success");
      setFeedback(`Processed ${data?.processed ?? 0} scheduled campaign(s), sent ${data?.sent ?? 0} emails.`);
      await refreshCampaigns();
    } catch {
      setStatus("error");
      setFeedback("Network error while processing scheduled campaigns.");
    }
  }

  return (
    <section className="mb-6 rounded-lg border border-zinc-800 bg-zinc-900/70 p-4 sm:p-5">
      <div className="mb-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-amber-400">Campaign</p>
        <h2 className="mt-1 text-lg font-semibold text-white">Client campaign workspace</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Signed in as {username || "admin"} ({role}). Target {targetLabel} in {geoSummary}.
        </p>
      </div>

      <form onSubmit={handleSend} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="title" className="mb-1 block text-xs font-medium uppercase tracking-wider text-zinc-500">
              Campaign title
            </label>
            <input
              id="title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="April Product Update"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400"
            />
          </div>

          {role === "owner" && clients.length > 0 && (
            <div>
              <label htmlFor="workspace" className="mb-1 block text-xs font-medium uppercase tracking-wider text-zinc-500">
                Workspace
              </label>
              <select
                id="workspace"
                value={selectedClientId}
                onChange={(e) => setSelectedClientId(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-amber-400"
              >
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div>
          <label htmlFor="audience" className="mb-1 block text-xs font-medium uppercase tracking-wider text-zinc-500">
            Audience
          </label>
          <select
            id="audience"
            value={audience}
            onChange={(e) => setAudience(e.target.value as Audience)}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-amber-400"
          >
            <option value="confirmed">Confirmed subscribers</option>
            <option value="pending">Pending subscribers</option>
            <option value="all">All subscribers</option>
          </select>
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          <div>
            <label htmlFor="geoCountry" className="mb-1 block text-xs font-medium uppercase tracking-wider text-zinc-500">
              Country
            </label>
            <select
              id="geoCountry"
              value={geoCountry}
              onChange={(e) => setGeoCountry(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-amber-400"
            >
              <option value="">All countries</option>
              {countryOptions.map((country) => (
                <option key={country} value={country}>
                  {country}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="geoRegion" className="mb-1 block text-xs font-medium uppercase tracking-wider text-zinc-500">
              Region
            </label>
            <select
              id="geoRegion"
              value={geoRegion}
              onChange={(e) => setGeoRegion(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-amber-400"
            >
              <option value="">All regions</option>
              {regionOptions.map((region) => (
                <option key={region} value={region}>
                  {region}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="geoCity" className="mb-1 block text-xs font-medium uppercase tracking-wider text-zinc-500">
              City
            </label>
            <select
              id="geoCity"
              value={geoCity}
              onChange={(e) => setGeoCity(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-amber-400"
            >
              <option value="">All cities</option>
              {cityOptions.map((city) => (
                <option key={city} value={city}>
                  {city}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="geoRadius" className="mb-1 block text-xs font-medium uppercase tracking-wider text-zinc-500">
            Radius (km, optional)
          </label>
          <input
            id="geoRadius"
            type="number"
            min={1}
            step={1}
            value={geoRadiusKm}
            onChange={(e) => setGeoRadiusKm(e.target.value)}
            placeholder="e.g. 50"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-amber-400"
          />
          <p className="mt-1 text-xs text-zinc-600">
            Radius uses subscriber lat/lng when available and centers on the selected city/region/country.
          </p>
        </div>

        <div>
          <label htmlFor="scheduledFor" className="mb-1 block text-xs font-medium uppercase tracking-wider text-zinc-500">
            Schedule for (optional)
          </label>
          <input
            id="scheduledFor"
            type="datetime-local"
            value={scheduledFor}
            onChange={(e) => setScheduledFor(e.target.value)}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-amber-400"
          />
        </div>

        <div>
          <label htmlFor="subject" className="mb-1 block text-xs font-medium uppercase tracking-wider text-zinc-500">
            Subject
          </label>
          <input
            id="subject"
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Weekly update"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400"
            required
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-zinc-500">
            Newsletter builder
          </label>

          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs text-zinc-600">
              Drag blocks from the right panel and edit text inline.
            </p>
            <button
              type="button"
              onClick={() => {
                resetComposer();
              }}
              className="rounded-lg border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
            >
              New draft
            </button>
          </div>

          <div className="overflow-hidden rounded-lg border border-zinc-700 bg-zinc-950">
            <div ref={editorContainerRef} className="min-h-[560px]" />
          </div>
          {!editorReady && (
            <p className="mt-2 text-xs text-zinc-600">Loading editor...</p>
          )}
        </div>

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <button
            type="button"
            disabled={!canEdit || status === "sending"}
            onClick={() => saveCampaign("draft")}
            className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-300 transition hover:border-zinc-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            Save draft
          </button>

          <button
            type="button"
            disabled={!canEdit || status === "sending"}
            onClick={() => saveCampaign("scheduled")}
            className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-300 transition hover:border-zinc-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            Schedule
          </button>

          <button
            type="button"
            disabled={!canEdit || status === "sending"}
            onClick={runScheduledNow}
            className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-300 transition hover:border-zinc-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            Run due schedules
          </button>
        </div>

        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <input
            type="email"
            value={testEmail}
            onChange={(e) => setTestEmail(e.target.value)}
            placeholder="test@client.com"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400"
          />
          <button
            type="button"
            disabled={!canEdit || status === "sending"}
            onClick={sendTestEmail}
            className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-300 transition hover:border-zinc-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            Send test
          </button>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={!canEdit || status === "sending"}
            className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-black transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {status === "sending" ? "Sending..." : "Send now"}
          </button>
          {feedback && (
            <p
              className={`text-sm ${
                status === "error" ? "text-red-400" : "text-zinc-400"
              }`}
            >
              {feedback}
            </p>
          )}
        </div>
      </form>

      <div className="mt-6 rounded-lg border border-zinc-800 bg-zinc-950/70 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">Previous campaigns & drafts</h3>
          {loadingCampaigns && <span className="text-xs text-zinc-600">Loading...</span>}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-left text-xs uppercase tracking-wider text-zinc-500">
                <th className="py-2 pr-3">Title</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Subject</th>
                <th className="py-2 pr-3">Updated</th>
                <th className="py-2 pr-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-4 text-zinc-600">No campaigns yet.</td>
                </tr>
              ) : (
                campaigns.map((campaign) => (
                  <tr key={campaign.id} className="border-b border-zinc-900 last:border-0">
                    <td className="py-2 pr-3 text-zinc-200">{campaign.title}</td>
                    <td className="py-2 pr-3 text-zinc-400">{campaign.status}</td>
                    <td className="py-2 pr-3 text-zinc-400">{campaign.subject}</td>
                    <td className="py-2 pr-3 text-zinc-500">{new Date(campaign.updated_at).toLocaleString()}</td>
                    <td className="py-2 pr-3">
                      <button
                        type="button"
                        onClick={() => loadCampaign(campaign)}
                        className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-zinc-500"
                      >
                        Load
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
