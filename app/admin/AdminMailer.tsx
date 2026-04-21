"use client";

import { useMemo, useState } from "react";

type Audience = "confirmed" | "all" | "pending";

type SendStatus = "idle" | "sending" | "success" | "error";

interface AdminMailerProps {
  totalCount: number;
  confirmedCount: number;
}

function audienceLabel(audience: Audience, totalCount: number, confirmedCount: number) {
  if (audience === "all") return `all subscribers (${totalCount})`;
  if (audience === "pending") return `pending subscribers (${Math.max(totalCount - confirmedCount, 0)})`;
  return `confirmed subscribers (${confirmedCount})`;
}

export default function AdminMailer({ totalCount, confirmedCount }: AdminMailerProps) {
  const [audience, setAudience] = useState<Audience>("confirmed");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<SendStatus>("idle");
  const [feedback, setFeedback] = useState("");

  const targetLabel = useMemo(
    () => audienceLabel(audience, totalCount, confirmedCount),
    [audience, totalCount, confirmedCount]
  );

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();

    if (!subject.trim() || !message.trim()) {
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
          message: message.trim(),
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
      setMessage("");
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
          <label htmlFor="message" className="mb-1 block text-xs font-medium uppercase tracking-wider text-zinc-500">
            Message
          </label>
          <textarea
            id="message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={8}
            placeholder="Write your email body here..."
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400"
            required
          />
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
