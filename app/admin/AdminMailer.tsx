"use client";

import { useMemo, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

type Audience = "confirmed" | "all" | "pending";

type SendStatus = "idle" | "sending" | "success" | "error";

interface AdminMailerProps {
  totalCount: number;
  confirmedCount: number;
}

function ToolbarButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded border px-2 py-1 text-xs transition ${
        active
          ? "border-amber-400 bg-amber-400/20 text-amber-300"
          : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
      }`}
    >
      {label}
    </button>
  );
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

  const editor = useEditor({
    extensions: [StarterKit],
    content: "<p></p>",
    editorProps: {
      attributes: {
        class:
          "tiptap-editor min-h-[220px] rounded-b-lg border border-t-0 border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white outline-none",
      },
    },
  });

  const targetLabel = useMemo(
    () => audienceLabel(audience, totalCount, confirmedCount),
    [audience, totalCount, confirmedCount]
  );

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();

    const messageText = editor?.getText().trim() ?? "";
    const messageHtml = editor?.getHTML() ?? "";

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
      editor?.commands.clearContent(true);
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
            Message
          </label>

          <div className="flex flex-wrap gap-1 rounded-t-lg border border-zinc-700 border-b-0 bg-zinc-950 px-2 py-2">
            <ToolbarButton
              label="Bold"
              active={editor?.isActive("bold")}
              onClick={() => editor?.chain().focus().toggleBold().run()}
            />
            <ToolbarButton
              label="Italic"
              active={editor?.isActive("italic")}
              onClick={() => editor?.chain().focus().toggleItalic().run()}
            />
            <ToolbarButton
              label="H2"
              active={editor?.isActive("heading", { level: 2 })}
              onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
            />
            <ToolbarButton
              label="Bullet"
              active={editor?.isActive("bulletList")}
              onClick={() => editor?.chain().focus().toggleBulletList().run()}
            />
            <ToolbarButton
              label="Numbered"
              active={editor?.isActive("orderedList")}
              onClick={() => editor?.chain().focus().toggleOrderedList().run()}
            />
            <ToolbarButton
              label="Quote"
              active={editor?.isActive("blockquote")}
              onClick={() => editor?.chain().focus().toggleBlockquote().run()}
            />
          </div>

          <EditorContent editor={editor} />
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
