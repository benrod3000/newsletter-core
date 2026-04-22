"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import CampaignReportPanel from "./CampaignReportPanel";
import type { Editor } from "grapesjs";

type Audience = "confirmed" | "all" | "pending" | "claimed_offer";

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
    regions?: string[];
    cities?: string[];
    region?: string | null;
    city?: string | null;
    center_lat?: number | null;
    center_lng?: number | null;
    radius_km?: number | null;
    radius_value?: number | null;
    radius_unit?: "km" | "mi";
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
  claimedLeadMagnetCount: number;
  subscribers: Array<{
    country: string | null;
    region: string | null;
    city: string | null;
    lead_magnet_claimed?: boolean;
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

function audienceLabel(audience: Audience, totalCount: number, confirmedCount: number, claimedLeadMagnetCount: number) {
  if (audience === "all") return `all subscribers (${totalCount})`;
  if (audience === "pending") return `pending subscribers (${Math.max(totalCount - confirmedCount, 0)})`;
  if (audience === "claimed_offer") return `claimed digital good (${claimedLeadMagnetCount})`;
  return `confirmed subscribers (${confirmedCount})`;
}

const PERSONALIZATION_TOKENS: Array<{ token: string; meaning: string; example: string }> = [
  { token: "{{first_name}}", meaning: "Subscriber first name", example: "Jamie" },
  { token: "{{last_name}}", meaning: "Subscriber last name", example: "Lee" },
  { token: "{{full_name}}", meaning: "First + last name", example: "Jamie Lee" },
  { token: "{{date_of_birth}}", meaning: "Birth date (YYYY-MM-DD)", example: "1990-06-10" },
  { token: "{{birthday_pretty}}", meaning: "Birth date (Month Day)", example: "June 10" },
  { token: "{{phone_number}}", meaning: "Phone number", example: "+1 310 555 0188" },
  { token: "{{city}}", meaning: "City", example: "Los Angeles" },
  { token: "{{region}}", meaning: "State or province", example: "California" },
  { token: "{{country}}", meaning: "Country", example: "United States" },
  { token: "{{location}}", meaning: "Full location (City, Region, Country)", example: "Los Angeles, California, United States" },
  { token: "{{email}}", meaning: "Subscriber email", example: "fan@example.com" },
  { token: "{{unsubscribe_url}}", meaning: "Personal unsubscribe link", example: "https://.../unsubscribe?token=..." },
  { token: "{{first_name|there}}", meaning: "First name with fallback", example: "there" },
];

export default function AdminMailer({ totalCount, confirmedCount, claimedLeadMagnetCount, subscribers }: AdminMailerProps) {
  const [audience, setAudience] = useState<Audience>("confirmed");
  const [title, setTitle] = useState("Untitled Draft");
  const [subject, setSubject] = useState("");
  const [scheduledFor, setScheduledFor] = useState("");
  const [testEmail, setTestEmail] = useState("");
  const [geoCountry, setGeoCountry] = useState("");
  const [geoRegions, setGeoRegions] = useState<string[]>([]);
  const [geoCities, setGeoCities] = useState<string[]>([]);
  const [regionSearch, setRegionSearch] = useState("");
  const [citySearch, setCitySearch] = useState("");
  const [geoRadiusValue, setGeoRadiusValue] = useState("");
  const [geoRadiusUnit, setGeoRadiusUnit] = useState<"km" | "mi">("mi");
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [clients, setClients] = useState<ClientWorkspace[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>("");
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [role, setRole] = useState<Role>("owner");
  const [username, setUsername] = useState("");
  const [loadingCampaigns, setLoadingCampaigns] = useState(true);
  const [status, setStatus] = useState<SendStatus>("idle");
  const [feedback, setFeedback] = useState("");
  const [tokenCopyFeedback, setTokenCopyFeedback] = useState("");
  const [expandedReportId, setExpandedReportId] = useState<string | null>(null);
  const [reportCache, setReportCache] = useState<Record<string, unknown>>({});
  const [reportLoading, setReportLoading] = useState<Set<string>>(new Set());
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
    () => audienceLabel(audience, totalCount, confirmedCount, claimedLeadMagnetCount),
    [audience, totalCount, confirmedCount, claimedLeadMagnetCount]
  );

  const countryOptions = useMemo(() => uniqueGeo(subscribers.map((s) => s.country)), [subscribers]);
  const regionOptions = useMemo(
    () =>
      uniqueGeo(
        subscribers
          .filter((s) => (geoCountry ? s.country === geoCountry : true))
          .map((s) => s.region)
      ),
    [subscribers, geoCountry]
  );
  const cityOptions = useMemo(
    () =>
      uniqueGeo(
        subscribers
          .filter((s) => (geoCountry ? s.country === geoCountry : true))
          .filter((s) => (geoRegions.length > 0 ? (s.region ? geoRegions.includes(s.region) : false) : true))
          .map((s) => s.city)
      ),
    [subscribers, geoCountry, geoRegions]
  );

  const filteredRegionOptions = useMemo(() => {
    const term = regionSearch.trim().toLowerCase();
    if (!term) return regionOptions;
    return regionOptions.filter((item) => item.toLowerCase().includes(term));
  }, [regionOptions, regionSearch]);

  const filteredCityOptions = useMemo(() => {
    const term = citySearch.trim().toLowerCase();
    if (!term) return cityOptions;
    return cityOptions.filter((item) => item.toLowerCase().includes(term));
  }, [cityOptions, citySearch]);

  useEffect(() => {
    setGeoRegions((current) => current.filter((value) => regionOptions.includes(value)));
  }, [regionOptions]);

  useEffect(() => {
    setGeoCities((current) => current.filter((value) => cityOptions.includes(value)));
  }, [cityOptions]);

  const geoSummary = useMemo(() => {
    const parts = [
      geoCities.length > 0 ? `${geoCities.length} cities` : "",
      geoRegions.length > 0 ? `${geoRegions.length} regions` : "",
      geoCountry,
    ].filter(Boolean);
    const location = parts.length ? parts.join(", ") : "all locations";
    return geoRadiusValue ? `${location} within ${geoRadiusValue} ${geoRadiusUnit}` : location;
  }, [geoCities, geoRegions, geoCountry, geoRadiusValue, geoRadiusUnit]);

  function buildGeoFilterPayload() {
    return {
      country: geoCountry || null,
      regions: geoRegions,
      cities: geoCities,
      radius_value: geoRadiusValue ? Number.parseFloat(geoRadiusValue) : null,
      radius_unit: geoRadiusUnit,
    };
  }

  function toggleRegion(value: string) {
    setGeoRegions((current) =>
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value]
    );
  }

  function toggleCity(value: string) {
    setGeoCities((current) =>
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value]
    );
  }

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
    setGeoRegions(
      campaign.geo_filter?.regions?.length
        ? campaign.geo_filter.regions
        : campaign.geo_filter?.region
          ? [campaign.geo_filter.region]
          : []
    );
    setGeoCities(
      campaign.geo_filter?.cities?.length
        ? campaign.geo_filter.cities
        : campaign.geo_filter?.city
          ? [campaign.geo_filter.city]
          : []
    );
    setGeoRadiusUnit(campaign.geo_filter?.radius_unit === "km" ? "km" : "mi");
    setGeoRadiusValue(
      typeof campaign.geo_filter?.radius_value === "number"
        ? String(campaign.geo_filter.radius_value)
        : typeof campaign.geo_filter?.radius_km === "number"
          ? String(campaign.geo_filter.radius_km)
          : ""
    );
    setPreviewCount(null);
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
    setGeoRegions([]);
    setGeoCities([]);
    setGeoRadiusValue("");
    setGeoRadiusUnit("mi");
    setPreviewCount(null);
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
          geoFilter: buildGeoFilterPayload(),
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
          geoFilter: buildGeoFilterPayload(),
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
          geoFilter: buildGeoFilterPayload(),
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

  async function toggleReport(campaignId: string) {
    if (expandedReportId === campaignId) {
      setExpandedReportId(null);
      return;
    }
    setExpandedReportId(campaignId);
    if (reportCache[campaignId]) return; // already fetched
    setReportLoading((prev) => new Set(prev).add(campaignId));
    try {
      const res = await fetch(`/api/admin/campaigns/${campaignId}/report`);
      const data = await res.json().catch(() => null);
      if (res.ok) setReportCache((prev) => ({ ...prev, [campaignId]: data }));
    } finally {
      setReportLoading((prev) => { const s = new Set(prev); s.delete(campaignId); return s; });
    }
  }

  async function previewAudience() {
    setPreviewLoading(true);
    setFeedback("");
    try {
      const res = await fetch("/api/admin/audience/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId: selectedCampaignId || undefined,
          clientId: selectedClientId || undefined,
          audience,
          geoFilter: buildGeoFilterPayload(),
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setStatus("error");
        setFeedback(data?.error ?? "Failed to preview audience.");
        return;
      }

      setPreviewCount(typeof data?.count === "number" ? data.count : 0);
    } catch {
      setStatus("error");
      setFeedback("Network error while previewing audience.");
    } finally {
      setPreviewLoading(false);
    }
  }

  async function copyToken(token: string) {
    try {
      await navigator.clipboard.writeText(token);
      setTokenCopyFeedback(`${token} copied`);
      setTimeout(() => setTokenCopyFeedback(""), 1400);
    } catch {
      setTokenCopyFeedback("Could not copy token.");
      setTimeout(() => setTokenCopyFeedback(""), 1400);
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

      <form onSubmit={handleSend} className="grid gap-4 lg:grid-cols-[320px,1fr]">
        <div className="space-y-3">
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
            <option value="claimed_offer">Claimed digital good</option>
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
              Regions
            </label>
            <input
              id="geoRegion"
              type="search"
              value={regionSearch}
              onChange={(e) => setRegionSearch(e.target.value)}
              placeholder="Search regions"
              className="mb-2 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-amber-400"
            />
            <div className="max-h-28 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950/60 p-2">
              <div className="flex flex-wrap gap-1.5">
                {filteredRegionOptions.length === 0 ? (
                  <span className="text-xs text-zinc-600">No matching regions</span>
                ) : (
                  filteredRegionOptions.map((region) => (
                    <button
                      key={region}
                      type="button"
                      onClick={() => toggleRegion(region)}
                      className={`rounded-full border px-2 py-1 text-xs transition ${
                        geoRegions.includes(region)
                          ? "border-amber-400 bg-amber-400/20 text-amber-200"
                          : "border-zinc-700 text-zinc-300 hover:border-zinc-500"
                      }`}
                    >
                      {region}
                    </button>
                  ))
                )}
              </div>
            </div>
            {geoRegions.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {geoRegions.map((region) => (
                  <button
                    key={region}
                    type="button"
                    onClick={() => toggleRegion(region)}
                    className="rounded-full border border-amber-500/60 bg-amber-500/10 px-2 py-1 text-xs text-amber-200"
                  >
                    {region} x
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setGeoRegions([])}
                  className="rounded-full border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:border-zinc-500"
                >
                  Clear
                </button>
              </div>
            )}
          </div>

          <div>
            <label htmlFor="geoCity" className="mb-1 block text-xs font-medium uppercase tracking-wider text-zinc-500">
              Cities
            </label>
            <input
              id="geoCity"
              type="search"
              value={citySearch}
              onChange={(e) => setCitySearch(e.target.value)}
              placeholder="Search cities"
              className="mb-2 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-amber-400"
            />
            <div className="max-h-28 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950/60 p-2">
              <div className="flex flex-wrap gap-1.5">
                {filteredCityOptions.length === 0 ? (
                  <span className="text-xs text-zinc-600">No matching cities</span>
                ) : (
                  filteredCityOptions.map((city) => (
                    <button
                      key={city}
                      type="button"
                      onClick={() => toggleCity(city)}
                      className={`rounded-full border px-2 py-1 text-xs transition ${
                        geoCities.includes(city)
                          ? "border-amber-400 bg-amber-400/20 text-amber-200"
                          : "border-zinc-700 text-zinc-300 hover:border-zinc-500"
                      }`}
                    >
                      {city}
                    </button>
                  ))
                )}
              </div>
            </div>
            {geoCities.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {geoCities.map((city) => (
                  <button
                    key={city}
                    type="button"
                    onClick={() => toggleCity(city)}
                    className="rounded-full border border-amber-500/60 bg-amber-500/10 px-2 py-1 text-xs text-amber-200"
                  >
                    {city} x
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setGeoCities([])}
                  className="rounded-full border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:border-zinc-500"
                >
                  Clear
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <div>
          <label htmlFor="geoRadius" className="mb-1 block text-xs font-medium uppercase tracking-wider text-zinc-500">
            Radius (optional)
          </label>
          <input
            id="geoRadius"
            type="number"
            min={1}
            step={1}
            value={geoRadiusValue}
            onChange={(e) => setGeoRadiusValue(e.target.value)}
            placeholder="e.g. 50"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-amber-400"
          />
          <p className="mt-1 text-xs text-zinc-600">
            Radius uses subscriber lat/lng when available and centers on the selected city/region/country.
          </p>
          </div>
          <div>
            <label htmlFor="geoRadiusUnit" className="mb-1 block text-xs font-medium uppercase tracking-wider text-zinc-500">
              Unit
            </label>
            <select
              id="geoRadiusUnit"
              value={geoRadiusUnit}
              onChange={(e) => setGeoRadiusUnit(e.target.value === "mi" ? "mi" : "km")}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-amber-400"
            >
              <option value="mi">Miles</option>
              <option value="km">Kilometers</option>
            </select>
          </div>
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-zinc-400">
              Estimated recipients: <span className="font-semibold text-zinc-100">{previewCount ?? "-"}</span>
            </p>
            <button
              type="button"
              disabled={previewLoading}
              onClick={previewAudience}
              className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:border-zinc-500 hover:text-white disabled:opacity-60"
            >
              {previewLoading ? "Checking..." : "Preview audience"}
            </button>
          </div>
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

        </div>

        <div className="space-y-3">

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
                <th className="py-2 pr-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-4 text-zinc-600">No campaigns yet.</td>
                </tr>
              ) : (
                campaigns.map((campaign) => (
                  <>
                    <tr key={campaign.id} className="border-b border-zinc-900 last:border-0">
                      <td className="py-2 pr-3 text-zinc-200">{campaign.title}</td>
                      <td className="py-2 pr-3 text-zinc-400">{campaign.status}</td>
                      <td className="py-2 pr-3 text-zinc-400">{campaign.subject}</td>
                      <td className="py-2 pr-3 text-zinc-500">{new Date(campaign.updated_at).toLocaleString()}</td>
                      <td className="py-2 pr-3">
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => loadCampaign(campaign)}
                            className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-zinc-500"
                          >
                            Load
                          </button>
                          {campaign.status === "sent" && (
                            <button
                              type="button"
                              onClick={() => toggleReport(campaign.id)}
                              className={`rounded border px-2 py-1 text-xs transition ${
                                expandedReportId === campaign.id
                                  ? "border-amber-500/60 bg-amber-500/10 text-amber-300"
                                  : "border-zinc-700 text-zinc-300 hover:border-zinc-500"
                              }`}
                            >
                              Stats
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {expandedReportId === campaign.id && (
                      <tr>
                        <td colSpan={5} className="pb-3 pt-1">
                          <CampaignReportPanel
                            report={reportCache[campaign.id] as Parameters<typeof CampaignReportPanel>[0]["report"]}
                            loading={reportLoading.has(campaign.id)}
                          />
                        </td>
                      </tr>
                    )}
                  </>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-6 rounded-lg border border-zinc-800 bg-zinc-950/70 p-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">Personalization key</h3>
        <p className="mt-1 text-sm text-zinc-500">
          Use merge tokens in your subject and newsletter content. Tokens are wrapped in double curly braces.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-left text-xs uppercase tracking-wider text-zinc-500">
                <th className="py-2 pr-3">Token</th>
                <th className="py-2 pr-3">Meaning</th>
                <th className="py-2 pr-3">Example output</th>
                <th className="py-2 pr-3">Copy</th>
              </tr>
            </thead>
            <tbody>
              {PERSONALIZATION_TOKENS.map((item) => (
                <tr key={item.token} className="border-b border-zinc-900 last:border-0">
                  <td className="py-2 pr-3 font-mono text-xs text-amber-300">{item.token}</td>
                  <td className="py-2 pr-3 text-zinc-400">{item.meaning}</td>
                  <td className="py-2 pr-3 text-zinc-500">{item.example}</td>
                  <td className="py-2 pr-3">
                    <button
                      type="button"
                      onClick={() => copyToken(item.token)}
                      className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-zinc-500"
                    >
                      Copy
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 rounded border border-zinc-800 bg-zinc-900/40 p-3 text-xs text-zinc-400">
          <p className="font-semibold text-zinc-300">Example</p>
          <p className="mt-1 font-mono text-amber-300">{"Hi {{first_name}}, we know your birthday is coming up on {{birthday_pretty}}."}</p>
          <p className="mt-1 font-mono text-amber-300">{"Hi {{first_name|there}}, we know your birthday is coming up on {{birthday_pretty|soon}}."}</p>
          <p className="mt-2 text-zinc-500">If a field is missing for a subscriber, the token resolves to an empty value.</p>
          <p className="mt-1 text-zinc-500">{"Use a fallback with the pipe syntax to avoid blanks, e.g. {{first_name|there}}."}</p>
          {tokenCopyFeedback && <p className="mt-2 text-emerald-400">{tokenCopyFeedback}</p>}
        </div>
      </div>
    </section>
  );
}
