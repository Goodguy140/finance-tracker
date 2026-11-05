import type { Metadata } from "next";

export const metadata: Metadata = { title: "Back to Finances · Finance Tracker" };

/**
 * Where a bank's own sign-in sends someone back to Plaid Link in the phone app (`redirect_uri`,
 * `src/lib/app-bank-link.ts`). On an iPhone with the app, iOS opens the app instead of this page
 * (the app-site association's `applinks`), and Link carries on there. The page shows only when
 * that did not happen. Public (`src/proxy.ts`) and static: it must never carry user data, and it
 * ignores Plaid's query string.
 */
export default function PlaidOAuthReturnPage() {
  return (
    <main className="mx-4 mt-[max(5rem,calc(env(safe-area-inset-top)+3rem))] max-w-md rounded-2xl border border-slate-800 bg-slate-900/80 p-6 text-slate-100 shadow-xl sm:mx-auto">
      <h1 className="mb-2 text-2xl font-semibold">Back to Finances</h1>
      <p className="text-sm text-slate-400">
        Your bank has finished. Open the Finances app on this phone to finish connecting it. If you
        started on a computer, go back to that window instead.
      </p>
    </main>
  );
}
