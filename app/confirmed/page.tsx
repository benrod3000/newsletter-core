interface Props {
  searchParams: Promise<{ status?: string | string[] }>;
}

export default async function ConfirmedPage({ searchParams }: Props) {
  const params = await searchParams;
  const rawStatus = params.status;
  const status = Array.isArray(rawStatus) ? rawStatus[0] : rawStatus;

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
