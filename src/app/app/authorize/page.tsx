import type { Metadata } from "next";
import { AppAuthorizeConsent } from "@/components/app-authorize-consent";
import { IdentityConfirmationProvider } from "@/components/mfa/confirm-identity";
import { appRedirectUrl, parseAuthorizeRequest } from "@/lib/app-devices";
import { identityPromptFor } from "@/lib/recent-identity";
import { requireLoadedUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Sign in to the app · Finance Tracker" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Opened by the phone app in the system sign-in sheet (`src/lib/app-devices.ts`, step 1). An
 * ordinary signed-in page: signed out, the proxy sends it to /login with `next`, and a pending
 * second factor goes through /mfa, so every way of signing in works here unchanged.
 */
export default async function AppAuthorizePage({ searchParams }: { searchParams: SearchParams }) {
  const loaded = await requireLoadedUser();
  const parsed = parseAuthorizeRequest(await searchParams);

  return (
    <main className="mx-auto mt-20 w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/80 p-6 text-slate-100 shadow-xl backdrop-blur">
      <h1 className="mb-4 text-2xl font-semibold text-slate-100">Sign in to the app</h1>
      {parsed.ok ? (
        <IdentityConfirmationProvider prompt={await identityPromptFor(loaded)}>
          <AppAuthorizeConsent
            request={parsed.request}
            email={loaded.user.email}
            cancelUrl={appRedirectUrl({ error: "access_denied" }, parsed.request.state)}
          />
        </IdentityConfirmationProvider>
      ) : (
        <p role="alert" className="rounded-lg border border-amber-800/80 bg-amber-950/40 px-3 py-2 text-sm text-amber-100">
          {parsed.error}
        </p>
      )}
    </main>
  );
}
