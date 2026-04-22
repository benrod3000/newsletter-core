interface Props {
  searchParams: Promise<{ status?: string | string[]; lead_title?: string | string[]; lead_url?: string | string[] }>;
}

export default async function ConfirmedPage({ searchParams }: Props) {
  const params = await searchParams;
  const rawStatus = params.status;
  const rawLeadTitle = params.lead_title;
  const rawLeadUrl = params.lead_url;
  const status = Array.isArray(rawStatus) ? rawStatus[0] : rawStatus;
  const leadTitle = Array.isArray(rawLeadTitle) ? rawLeadTitle[0] : rawLeadTitle;
  const leadUrl = Array.isArray(rawLeadUrl) ? rawLeadUrl[0] : rawLeadUrl;

  let safeLeadUrl: string | null = null;
  if (typeof leadUrl === "string") {
    try {
      const parsed = new URL(leadUrl);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        safeLeadUrl = parsed.toString();
      }
    } catch {
      safeLeadUrl = null;
    }
  }

  const isOk = status === "ok";
  const isInvalid = status === "invalid";
  const isAlready = status === "already";

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 bg-[#0d0d0d]">
      <div className="w-full max-w-xl">
        <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-amber-400">
          Newsletter Services
        </p>

        {isOk ? (
          <>
            <h1 className="text-5xl font-bold leading-tight tracking-tight text-white">
              You&apos;re confirmed.
            </h1>
            <p className="mt-5 text-lg leading-relaxed text-zinc-400">
              Your subscription is active. First issue drops weekly — keep an eye on your inbox.
            </p>
            {safeLeadUrl && (
              <div className="mt-6 rounded-lg border border-emerald-700/60 bg-emerald-950/30 px-4 py-4">
                <p className="text-sm font-semibold text-emerald-200">Your free download is ready</p>
                <p className="mt-1 text-sm text-emerald-300/90">
                  {leadTitle?.trim() || "Free media download"}
                </p>
                <a
                  href={safeLeadUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-block rounded bg-emerald-400 px-4 py-2 text-sm font-semibold text-black hover:bg-emerald-300"
                >
                  Get your free file
                </a>
              </div>
            )}
          </>
        ) : isAlready ? (
          <>
            <h1 className="text-5xl font-bold leading-tight tracking-tight text-white">
              Already confirmed.
            </h1>
            <p className="mt-5 text-lg leading-relaxed text-zinc-400">
              This email is already confirmed and active on the list.
            </p>
          </>
        ) : isInvalid ? (
          <>
            <h1 className="text-5xl font-bold leading-tight tracking-tight text-white">
              Link expired.
            </h1>
            <p className="mt-5 text-lg leading-relaxed text-zinc-400">
              This confirmation link is no longer valid. You may already be confirmed.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-5xl font-bold leading-tight tracking-tight text-white">
              Something went wrong.
            </h1>
            <p className="mt-5 text-lg leading-relaxed text-zinc-400">
              We couldn&apos;t confirm your subscription. Please try again or reply to your confirmation email.
            </p>
          </>
        )}

        <div className="my-8 h-px w-16 bg-zinc-700" />
        <a
          href="/"
          className="text-sm text-amber-400 underline underline-offset-4 hover:text-amber-300"
        >
          ← Back home
        </a>
      </div>
    </main>
  );
}
