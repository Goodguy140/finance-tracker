import type { Metadata } from "next";
import { RetryButton } from "./retry-button";

export const metadata: Metadata = { title: "Offline · Finance Tracker" };

/**
 * What the service worker (`public/sw.js`) shows for a page it cannot reach and has no
 * copy of. Static and public (`src/proxy.ts`) so it can be precached; it must never carry
 * user data.
 */
export default function OfflinePage() {
  return (
    <main className="mx-4 mt-[max(5rem,calc(env(safe-area-inset-top)+3rem))] max-w-md rounded-2xl border border-slate-800 bg-slate-900/80 p-6 text-slate-100 shadow-xl sm:mx-auto">
      <h1 className="mb-2 text-2xl font-semibold">You&apos;re offline</h1>
      <p className="mb-5 text-sm text-slate-400">
        This page isn&apos;t available without a connection. The dashboard you last opened can still be viewed
        offline; everything else needs the network.
      </p>
      <RetryButton />
    </main>
  );
}
