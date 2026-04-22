export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[#0d0d0d] px-6 py-16 text-zinc-200">
      <div className="mx-auto max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-widest text-amber-400">Privacy Notice</p>
        <h1 className="mt-2 text-4xl font-bold text-white">How subscriber data is used</h1>
        <p className="mt-4 text-sm leading-7 text-zinc-400">
          This signup flow uses explicit email consent and analytics consent. We store contact information,
          campaign attribution, device and browser metadata, confirmation status, unsubscribe status, and
          geolocation derived from signup and email interactions so campaigns can be delivered, measured, and
          targeted by audience region.
        </p>

        <div className="mt-8 space-y-6 text-sm leading-7 text-zinc-300">
          <section>
            <h2 className="text-lg font-semibold text-white">What we collect</h2>
            <p className="mt-2">
              We may collect your email address, optional profile fields, IP-derived location, browser details,
              campaign source parameters, and interaction data such as opens, clicks, and digital-good claims.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white">Why we collect it</h2>
            <p className="mt-2">
              We use this data to send requested newsletters, measure engagement, detect abuse, deliver lead magnets,
              and build geographic audience segments for follow-up campaigns.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white">Your choices</h2>
            <p className="mt-2">
              You can unsubscribe at any time using the unsubscribe link in every email. If you need access,
              correction, or deletion support, contact the sender operating this newsletter instance.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white">Tracking disclosure</h2>
            <p className="mt-2">
              Emails may include open tracking, click tracking, browser-view links, and digital-good claim tracking.
              Claim events may refresh geolocation so campaigns can be targeted by city or region.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}