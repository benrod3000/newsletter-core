"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "grapesjs";

type Audience = "confirmed" | "all" | "pending";

type SendStatus = "idle" | "sending" | "success" | "error";

interface AdminMailerProps {
  totalCount: number;
  confirmedCount: number;
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

function audienceLabel(audience: Audience, totalCount: number, confirmedCount: number) {
  if (audience === "all") return `all subscribers (${totalCount})`;
  if (audience === "pending") return `pending subscribers (${Math.max(totalCount - confirmedCount, 0)})`;
  return `confirmed subscribers (${confirmedCount})`;
}

export default function AdminMailer({ totalCount, confirmedCount }: AdminMailerProps) {
  const [audience, setAudience] = useState<Audience>("confirmed");
  const [subject, setSubject] = useState("");
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

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();

    const editor = editorRef.current;
    if (!editor) {
      setStatus("error");
      setFeedback("Editor is still loading. Please try again in a moment.");
      return;
    }

    const messageHtml = editor.getHtml();
    const messageCss = editor.getCss();
    const messageText = htmlToText(messageHtml);

    if (!subject.trim() || !messageText) {
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
          audience,
          subject: subject.trim(),
          message: messageText,
          html: messageHtml,
          css: messageCss,
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
      setSubject("");
      editor.setComponents(DEFAULT_COMPONENTS);
      editor.setStyle(DEFAULT_STYLE);
    } catch {
      setStatus("error");
      setFeedback("Network error while sending email.");
    }
  }

  return (
    <section className="mb-6 rounded-lg border border-zinc-800 bg-zinc-900/70 p-4 sm:p-5">
      <div className="mb-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-amber-400">Campaign</p>
        <h2 className="mt-1 text-lg font-semibold text-white">Send email from dashboard</h2>
        <p className="mt-1 text-sm text-zinc-500">Target {targetLabel}. Uses SendGrid settings from environment variables.</p>
      </div>

      <form onSubmit={handleSend} className="space-y-3">
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
                const editor = editorRef.current;
                if (!editor) return;
                editor.setComponents(DEFAULT_COMPONENTS);
                editor.setStyle(DEFAULT_STYLE);
              }}
              className="rounded-lg border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
            >
              Reset template
            </button>
          </div>

          <div className="overflow-hidden rounded-lg border border-zinc-700 bg-zinc-950">
            <div ref={editorContainerRef} className="min-h-[560px]" />
          </div>
          {!editorReady && (
            <p className="mt-2 text-xs text-zinc-600">Loading editor...</p>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={status === "sending"}
            className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-black transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {status === "sending" ? "Sending..." : "Send email"}
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
    </section>
  );
}
